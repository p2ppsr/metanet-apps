# Metanet App Catalog

A Typescript library for publishing and discovering applications on the Metanet.

## Overview

Metanet Apps allows developers to:

- Publish application metadata to the Bitcoin SV blockchain using PushDrop tokens
- Update existing app listings with new metadata
- Discover apps using various search criteria like domain, category, tags, and more
- Build a decentralized app catalog

## Installation

```bash
npm install metanet-apps
```

## Basic Usage

### Initializing the App Catalog

```typescript
import { AppCatalog } from 'metanet-apps'

const catalog = new AppCatalog({
  // Optional parameters:
  // keyID: 'your-identity-key-id',  // Defaults to '1'
  // overlayTopic: 'custom_topic',  // Defaults to 'tm_apps'
  // overlayService: 'custom_service', // Defaults to 'ls_apps'
  // networkPreset: 'mainnet', // or 'testnet', 'local'
  // acceptDelayedBroadcast: false
})
```

### Publishing a New App

```typescript
const appMetadata = {
  version: '0.1.0',
  name: 'My Awesome App',
  description: 'This app does amazing things on Metanet',
  icon: 'https://example.com/icon.png',
  domain: 'myapp.example.com',
  category: 'utility',
  tags: ['tools', 'productivity'],
  release_date: new Date().toISOString()
}

const result = await catalog.publishApp(appMetadata)
console.log('Published app:', result)
```

### Finding Apps

```typescript
// Find by domain
const appsByDomain = await catalog.findApps({ domain: 'myapp.example.com' })

// Find by category
const utilityApps = await catalog.findApps({ category: 'utility' })

// Find by tags
const productivityApps = await catalog.findApps({ tags: ['productivity'] })

// Find by publisher
const myApps = await catalog.findApps({ publisher: '03abcdef...' })

// Fuzzy search by name
const searchResults = await catalog.findApps({ name: 'awesome' })
```

### Updating an App

```typescript
// First, find the app you want to update
const [myApp] = await catalog.findApps({ domain: 'myapp.example.com' })

// Create updated metadata
const updatedMetadata = {
  ...myApp.metadata,
  description: 'Updated description',
  version: '0.2.0', 
  changelog: 'Added new features'
}

// Send the update
const result = await catalog.updateApp(myApp, updatedMetadata)
console.log('Updated app:', result)
```

## API Reference

### `AppCatalog`

The main class for interacting with the Metanet Apps ecosystem.

#### Constructor

```typescript
new AppCatalog(options: AppCatalogOptions)
```

- `options.overlayTopic?`: Optional custom overlay topic (defaults to "tm_apps")
- `options.overlayService?`: Optional custom overlay service (defaults to "ls_apps")
- `options.wallet?`: Optional pre-configured wallet
- `options.networkPreset?`: Optional network preset ("mainnet" | "testnet" | "local")
- `options.acceptDelayedBroadcast?`: Optional broadcast options (defaults to false)

#### Methods

- `publishApp(metadata: PublishedAppMetadata, opts?: { wallet?: WalletInterface }): Promise<Transaction | BroadcastResponse | BroadcastFailure>`: Publishes an app to the overlay network
- `updateApp(prev: PublishedApp, newMetadata: PublishedAppMetadata): Promise<BroadcastResponse | BroadcastFailure>`: Updates an existing app listing
- `removeApp(prev: PublishedApp): Promise<BroadcastResponse | BroadcastFailure>`: Removes an app listing from the overlay network
- `findApps(query?: AppCatalogQuery, opts?: { resolver?: LookupResolver, wallet?: WalletInterface, includeBeef?: boolean }): Promise<PublishedApp[]>`: Searches for apps based on the provided query with support for pagination and sorting

## Types

### `AppCatalogQuery`

Query options for finding apps:

```typescript
interface AppCatalogQuery {
  domain?: string
  publisher?: string // PubKeyHex
  name?: string
  category?: string
  tags?: string[]
  limit?: number
  skip?: number
  sortOrder?: 'asc' | 'desc'
  startDate?: string
  endDate?: string
}
```

### `PublishedAppMetadata`

Metadata for a published app:

```typescript
interface PublishedAppMetadata {
  version: '0.1.0'
  name: string
  description: string
  icon: string // URL or UHRP
  httpURL?: string
  uhrpURL?: string
  domain: string
  publisher?: string // Automatically set by the library from wallet's identity key
  short_name?: string
  category?: string
  tags?: string[]
  release_date: string // ISO-8601
  changelog?: string
  banner_image_url?: string
  screenshot_urls?: string[]
}
```

### `PublishedApp`

A published app with its metadata and token information:

```typescript
interface PublishedApp {
  metadata: PublishedAppMetadata
  token: {
    txid: string
    outputIndex: number
    lockingScript: string
    satoshis: number
    beef?: number[]
  }
}
```

## License

This project is licensed under the [Open BSV License](https://github.com/bitcoin-sv/bitcoin-sv/blob/master/LICENSE).

## Author

Peer-to-peer Privacy Systems Research, LLC
