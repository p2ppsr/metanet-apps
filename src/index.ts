import {
  Beef,
  BroadcastFailure,
  BroadcastResponse,
  LookupAnswer,
  LookupResolver,
  PushDrop,
  TopicBroadcaster,
  Transaction,
  Utils,
  WalletClient,
  WalletInterface,
  WalletProtocol
} from '@bsv/sdk'
import { AppCatalogOptions, PublishedAppMetadata, AppCatalogQuery, PublishedApp } from './types/index.js'

/* ────────────────────────────────────────────────────────────
 * Constants
 * ────────────────────────────────────────────────────────── */
const PROTOCOL_ID: WalletProtocol = [1, 'metanet apps']
const DEFAULT_KEY_ID = '1'
const DEFAULT_OVERLAY_TOPIC = 'tm_apps'
const DEFAULT_LOOKUP_SERVICE = 'ls_apps'

/* ────────────────────────────────────────────────────────────
 * AppCatalog
 * ────────────────────────────────────────────────────────── */
export class AppCatalog {
  private readonly overlayTopic: string
  private readonly overlayService: string
  private readonly wallet: WalletInterface
  private readonly networkPreset: "mainnet" | "testnet" | "local" | undefined
  private readonly acceptDelayedBroadcast: boolean

  constructor(opts: AppCatalogOptions) {
    this.overlayTopic = opts.overlayTopic ?? DEFAULT_OVERLAY_TOPIC
    this.overlayService = opts.overlayService ?? DEFAULT_LOOKUP_SERVICE
    this.wallet = opts.wallet ?? new WalletClient()
    this.networkPreset = opts.networkPreset
    this.acceptDelayedBroadcast = opts.acceptDelayedBroadcast ?? false
  }

  /* ──────────────────────────────  Publish  ───────────────────────────── */
  /**
   * Publishes an app by embedding its metadata JSON into a PushDrop token
   * and broadcasting that token to the overlay network.
   */
  async publishApp(
    metadata: PublishedAppMetadata,
    opts: { wallet?: WalletInterface } = {}
  ): Promise<Transaction | BroadcastResponse | BroadcastFailure> {
    const wallet = opts.wallet ?? this.wallet
    metadata.publisher = (await wallet.getPublicKey({ identityKey: true })).publicKey

    // --- 1. Encode metadata as UTF‑8 bytes --------------------------------
    const jsonPayload = JSON.stringify(metadata)
    const payloadBytes = Utils.toArray(jsonPayload, 'utf8')

    // --- 2. Build PushDrop locking script --------------------------------
    const lockingScript = await new PushDrop(wallet).lock(
      [payloadBytes],
      PROTOCOL_ID,
      DEFAULT_KEY_ID,
      'anyone',
      true
    )

    // --- 3. Create the transaction --------------------------------------
    const { tx } = await wallet.createAction({
      description: 'AppCatalog - publish app',
      outputs: [
        {
          satoshis: 1,
          lockingScript: lockingScript.toHex(),
          outputDescription: 'Metanet App token'
        }
      ],
      options: { acceptDelayedBroadcast: this.acceptDelayedBroadcast, randomizeOutputs: false }
    })

    if (!tx) throw new Error('Failed to create transaction')

    const transaction = Transaction.fromAtomicBEEF(tx)

    // --- 4. Broadcast through overlay -----------------------------------
    const broadcaster = new TopicBroadcaster([this.overlayTopic], {
      networkPreset: this.networkPreset ?? (await this.wallet.getNetwork({})).network
    })
    return broadcaster.broadcast(transaction)
  }

  /* ──────────────────────────────  Update  ────────────────────────────── */
  /**
   * Updates an existing app listing by spending its previous PushDrop output
   * and creating a new one with the updated metadata. The new output is then
   * broadcast to the overlay.
   */
  async updateApp(
    prev: PublishedApp,
    newMetadata: PublishedAppMetadata
  ): Promise<BroadcastResponse | BroadcastFailure> {
    if (!prev.token.beef) throw new Error('App token must contain BEEF to update')

    // --- 1. Serialize new metadata --------------------------------------
    const jsonPayload = JSON.stringify(newMetadata)
    const payloadBytes = Utils.toArray(jsonPayload, 'utf8')

    // --- 2. Build new PushDrop locking script ---------------------------
    const newLockingScript = await new PushDrop(this.wallet).lock(
      [payloadBytes],
      PROTOCOL_ID,
      DEFAULT_KEY_ID,
      'anyone',
      true
    )

    // --- 3. Prepare spending of previous output -------------------------
    const pushdrop = new PushDrop(this.wallet)
    const prevOutpoint = `${prev.token.txid}.${prev.token.outputIndex}` as const

    const { signableTransaction } = await this.wallet.createAction({
      description: 'AppCatalog - update app',
      inputBEEF: prev.token.beef,
      inputs: [
        {
          outpoint: prevOutpoint,
          unlockingScriptLength: 74,
          inputDescription: 'Spend previous app token'
        }
      ],
      outputs: [
        {
          satoshis: 1,
          lockingScript: newLockingScript.toHex(),
          outputDescription: 'Updated Metanet App token'
        }
      ],
      options: { acceptDelayedBroadcast: this.acceptDelayedBroadcast, randomizeOutputs: false }
    })

    if (!signableTransaction) throw new Error('Unable to create update transaction')

    // --- 4. Produce unlocking script ------------------------------------
    const unlocker = pushdrop.unlock(PROTOCOL_ID, DEFAULT_KEY_ID, 'anyone')
    const unlockingScript = await unlocker.sign(
      Transaction.fromBEEF(signableTransaction.tx),
      0
    )

    // --- 5. Sign and finalize -------------------------------------------
    const { tx } = await this.wallet.signAction({
      reference: signableTransaction.reference,
      spends: { 0: { unlockingScript: unlockingScript.toHex() } }
    })

    if (!tx) throw new Error('Unable to finalize update transaction')

    const transaction = Transaction.fromAtomicBEEF(tx)

    // --- 6. Broadcast through overlay -----------------------------------
    const broadcaster = new TopicBroadcaster([this.overlayTopic], {
      networkPreset: this.networkPreset ?? (await this.wallet.getNetwork({})).network
    })
    return await broadcaster.broadcast(transaction)
  }

  /* ──────────────────────────────  Remove  ───────────────────────────── */
  /**
   * Removes an app listing from the overlay by spending its previous PushDrop output.
   * 
   * @param prev The previous app listing to remove.
   * @returns The BroadcastResponse or BroadcastFailure from the overlay.
   */
  async removeApp(
    prev: PublishedApp
  ): Promise<BroadcastResponse | BroadcastFailure> {
    if (!prev.token.beef) throw new Error('App token must contain BEEF to remove')

    const prevOutpoint = `${prev.token.txid}.${prev.token.outputIndex}` as const
    const { signableTransaction } = await this.wallet.createAction({
      description: 'AppCatalog - remove app',
      inputBEEF: prev.token.beef,
      inputs: [{
        outpoint: prevOutpoint,
        unlockingScriptLength: 74,
        inputDescription: 'Redeem app token'
      }],
      options: { acceptDelayedBroadcast: this.acceptDelayedBroadcast, randomizeOutputs: false }
    })
    if (!signableTransaction) throw new Error('Unable to redeem app token')

    const unlocker = new PushDrop(this.wallet).unlock(PROTOCOL_ID, DEFAULT_KEY_ID, 'anyone')
    const unlockingScript = await unlocker.sign(Transaction.fromBEEF(signableTransaction.tx), 0)

    const { tx } = await this.wallet.signAction({
      reference: signableTransaction.reference,
      spends: { 0: { unlockingScript: unlockingScript.toHex() } }
    })
    if (!tx) throw new Error('Unable to redeem app token')

    const transaction = Transaction.fromAtomicBEEF(tx)

    // Broadcast to overlay
    const broadcaster = new TopicBroadcaster([this.overlayTopic], {
      networkPreset: this.networkPreset ?? (await this.wallet.getNetwork({})).network
    })
    return await broadcaster.broadcast(transaction)
  }

  /* ──────────────────────────────  Find  ─────────────────────────────── */
  /**
   * Finds apps published to the overlay by querying the lookup service.
   * 
   * Supports pagination and sorting through the following parameters:
   * - `limit`: Maximum number of results to return (default: 50)
   * - `skip`: Number of results to skip for pagination (default: 0)
   * - `sortOrder`: Sort direction - 'asc' (oldest first) or 'desc' (newest first, default)
   * 
   * @example
   * // Get the first page of 20 results
   * const page1 = await appCatalog.findApps({ limit: 20, skip: 0 });
   * 
   * // Get the second page
   * const page2 = await appCatalog.findApps({ limit: 20, skip: 20 });
   * 
   * // Sort by oldest first
   * const oldestFirst = await appCatalog.findApps({ sortOrder: 'asc' });
   */
  async findApps(
    query: AppCatalogQuery = {},
    opts: { resolver?: LookupResolver; wallet?: WalletInterface; includeBeef?: boolean } = { includeBeef: true }
  ): Promise<PublishedApp[]> {
    const wallet = opts.wallet ?? this.wallet

    // --- 1. Build lookup query -----------------------------------------
    const lookupQuery: Record<string, unknown> = {}
    if (query.domain) lookupQuery.domain = query.domain
    if (query.publisher) lookupQuery.publisher = query.publisher
    if (query.name) lookupQuery.name = query.name
    if (query.category) lookupQuery.category = query.category
    if (query.tags?.length) lookupQuery.tags = query.tags
    if (query.limit !== undefined) lookupQuery.limit = query.limit
    if (query.skip !== undefined) lookupQuery.skip = query.skip
    if (query.sortOrder) lookupQuery.sortOrder = query.sortOrder
    if (query.startDate) lookupQuery.startDate = `${query.startDate}T00:00:00.000Z`
    if (query.endDate) lookupQuery.endDate = `${query.endDate}T23:59:59.999Z`

    // --- 2. Resolve -----------------------------------------------------
    const resolver =
      opts.resolver ??
      new LookupResolver({ networkPreset: this.networkPreset ?? (await wallet.getNetwork({})).network })

    const answer = await resolver.query({ service: this.overlayService, query: lookupQuery })

    // --- 3. Parse answer ------------------------------------------------
    return this.parseLookupAnswer(answer, opts.includeBeef!)
  }

  /* ───────────────────────── Helper: parse lookup ─────────────────────── */
  private parseLookupAnswer(ans: LookupAnswer, includeBeef: boolean): PublishedApp[] {
    if (ans.type !== 'output-list' || !ans.outputs.length) return []

    return ans.outputs.map(o => {
      const tx = Transaction.fromBEEF(o.beef)
      const out = tx.outputs[o.outputIndex]
      const decoded = PushDrop.decode(out.lockingScript)

      const jsonString = Utils.toUTF8(decoded.fields[0] as number[])
      const metadata: PublishedAppMetadata = JSON.parse(jsonString)

      return {
        metadata,
        token: {
          txid: tx.id('hex'),
          outputIndex: o.outputIndex,
          lockingScript: out.lockingScript.toHex(),
          satoshis: out.satoshis ?? 0,
          ...(includeBeef ? { beef: o.beef } : {})
        }
      }
    })
  }
}
