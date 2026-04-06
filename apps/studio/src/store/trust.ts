import { create } from 'zustand'
import {
  getOrCreateClientSideServerIdentityKeyPair,
  loadAllClientSideServerAuthorityRecords,
  loadAllTrustedClientSideServerRecords,
  saveClientSideServerAuthorityRecord,
  saveClientSideServerIdentityKeyPair,
  saveTrustedClientSideServerRecord,
  toClientSideServerPublicIdentity,
  type ClientSideServerExportedKeyPair,
  type ClientSideServerPublicIdentity,
  type ClientSideServerSignedAuthorityRecord,
  type ClientSideServerTrustedServerRecord,
} from '@modularizer/plat-client'
import type { Sample } from '../samples'

export interface TrustSnapshot {
  workspaceId: string
  serverName: string
  hostKeyPair: ClientSideServerExportedKeyPair | null
  knownHosts: Record<string, ClientSideServerTrustedServerRecord>
  authorityRecords: Record<string, ClientSideServerSignedAuthorityRecord>
  updatedAt: number
}

interface TrustStorageKeys {
  keyPair: string
  knownHosts: string
  authorityRecords: string
}

interface TrustState {
  hydratedWorkspaceId: string | null
  workspaceId: string | null
  serverName: string | null
  hostKeyPair: ClientSideServerExportedKeyPair | null
  publicIdentity: ClientSideServerPublicIdentity | null
  knownHosts: ClientSideServerTrustedServerRecord[]
  authorityRecords: ClientSideServerSignedAuthorityRecord[]
  saveState: 'idle' | 'saved'
  trustCurrentHost: () => Promise<void>
  hydrate: (sample: Sample) => Promise<void>
  importTrustedHostRecord: (source: string) => Promise<void>
  importAuthorityRecord: (source: string) => Promise<void>
  removeTrustedHost: (serverName: string) => Promise<void>
  removeAuthorityRecord: (serverName: string) => Promise<void>
  exportSnapshot: () => TrustSnapshot | null
  importSnapshot: (snapshot: TrustSnapshot) => Promise<void>
}

function getStorageKeys(workspaceId: string): TrustStorageKeys {
  return {
    keyPair: `browserver:trust:${workspaceId}:keypair`,
    knownHosts: `browserver:trust:${workspaceId}:known-hosts`,
    authorityRecords: `browserver:trust:${workspaceId}:authority-records`,
  }
}

function sortKnownHosts(records: Record<string, ClientSideServerTrustedServerRecord>) {
  return Object.values(records).sort((a, b) => b.trustedAt - a.trustedAt)
}

function sortAuthorityRecords(records: Record<string, ClientSideServerSignedAuthorityRecord>) {
  return Object.values(records).sort((a, b) => b.issuedAt - a.issuedAt)
}

function setStoredJson(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value))
}

function setSaveState(set: (partial: Partial<TrustState>) => void) {
  set({ saveState: 'saved' })
  window.setTimeout(() => {
    set({ saveState: 'idle' })
  }, 1200)
}

export const useTrustStore = create<TrustState>()((set, get) => ({
  hydratedWorkspaceId: null,
  workspaceId: null,
  serverName: null,
  hostKeyPair: null,
  publicIdentity: null,
  knownHosts: [],
  authorityRecords: [],
  saveState: 'idle',
  hydrate: async (sample) => {
    const storageKeys = getStorageKeys(sample.id)
    const hostKeyPair = await getOrCreateClientSideServerIdentityKeyPair({
      storage: window.localStorage,
      storageKey: storageKeys.keyPair,
      keyId: sample.id,
    })
    const publicIdentity = await toClientSideServerPublicIdentity(hostKeyPair)
    const knownHosts = loadAllTrustedClientSideServerRecords({
      storage: window.localStorage,
      storageKey: storageKeys.knownHosts,
    })
    const authorityRecords = loadAllClientSideServerAuthorityRecords({
      storage: window.localStorage,
      storageKey: storageKeys.authorityRecords,
    })

    set({
      hydratedWorkspaceId: sample.id,
      workspaceId: sample.id,
      serverName: sample.id,
      hostKeyPair,
      publicIdentity,
      knownHosts: sortKnownHosts(knownHosts),
      authorityRecords: sortAuthorityRecords(authorityRecords),
      saveState: 'idle',
    })
  },
  trustCurrentHost: async () => {
    const state = get()
    if (!state.workspaceId || !state.serverName || !state.publicIdentity) return

    const storageKeys = getStorageKeys(state.workspaceId)
    const record: ClientSideServerTrustedServerRecord = {
      serverName: state.serverName,
      publicKeyJwk: state.publicIdentity.publicKeyJwk,
      keyId: state.publicIdentity.keyId,
      fingerprint: state.publicIdentity.fingerprint,
      trustedAt: Date.now(),
      source: 'manual',
    }

    saveTrustedClientSideServerRecord(record, {
      storage: window.localStorage,
      storageKey: storageKeys.knownHosts,
    })

    const knownHosts = loadAllTrustedClientSideServerRecords({
      storage: window.localStorage,
      storageKey: storageKeys.knownHosts,
    })

    set({
      knownHosts: sortKnownHosts(knownHosts),
    })
    setSaveState(set)
  },
  importTrustedHostRecord: async (source) => {
    const state = get()
    if (!state.workspaceId) return
    const parsed = JSON.parse(source) as ClientSideServerTrustedServerRecord
    if (!parsed.serverName || !parsed.publicKeyJwk || !parsed.fingerprint) {
      throw new Error('Invalid trusted host record JSON')
    }

    const storageKeys = getStorageKeys(state.workspaceId)
    saveTrustedClientSideServerRecord(parsed, {
      storage: window.localStorage,
      storageKey: storageKeys.knownHosts,
    })

    const knownHosts = loadAllTrustedClientSideServerRecords({
      storage: window.localStorage,
      storageKey: storageKeys.knownHosts,
    })

    set({ knownHosts: sortKnownHosts(knownHosts) })
    setSaveState(set)
  },
  importAuthorityRecord: async (source) => {
    const state = get()
    if (!state.workspaceId) return
    const parsed = JSON.parse(source) as ClientSideServerSignedAuthorityRecord
    if (!parsed.serverName || !parsed.publicKeyJwk || !parsed.signature) {
      throw new Error('Invalid authority record JSON')
    }

    const storageKeys = getStorageKeys(state.workspaceId)
    saveClientSideServerAuthorityRecord(parsed, {
      storage: window.localStorage,
      storageKey: storageKeys.authorityRecords,
    })

    const authorityRecords = loadAllClientSideServerAuthorityRecords({
      storage: window.localStorage,
      storageKey: storageKeys.authorityRecords,
    })

    set({ authorityRecords: sortAuthorityRecords(authorityRecords) })
    setSaveState(set)
  },
  removeTrustedHost: async (serverName) => {
    const state = get()
    if (!state.workspaceId) return
    const storageKeys = getStorageKeys(state.workspaceId)
    const knownHosts = loadAllTrustedClientSideServerRecords({
      storage: window.localStorage,
      storageKey: storageKeys.knownHosts,
    })
    delete knownHosts[serverName]
    setStoredJson(storageKeys.knownHosts, knownHosts)
    set({ knownHosts: sortKnownHosts(knownHosts) })
    setSaveState(set)
  },
  removeAuthorityRecord: async (serverName) => {
    const state = get()
    if (!state.workspaceId) return
    const storageKeys = getStorageKeys(state.workspaceId)
    const authorityRecords = loadAllClientSideServerAuthorityRecords({
      storage: window.localStorage,
      storageKey: storageKeys.authorityRecords,
    })
    delete authorityRecords[serverName]
    setStoredJson(storageKeys.authorityRecords, authorityRecords)
    set({ authorityRecords: sortAuthorityRecords(authorityRecords) })
    setSaveState(set)
  },
  exportSnapshot: () => {
    const state = get()
    if (!state.workspaceId || !state.serverName) return null

    return {
      workspaceId: state.workspaceId,
      serverName: state.serverName,
      hostKeyPair: state.hostKeyPair,
      knownHosts: Object.fromEntries(state.knownHosts.map((record) => [record.serverName, record])),
      authorityRecords: Object.fromEntries(state.authorityRecords.map((record) => [record.serverName, record])),
      updatedAt: Date.now(),
    }
  },
  importSnapshot: async (snapshot) => {
    const storageKeys = getStorageKeys(snapshot.workspaceId)

    if (snapshot.hostKeyPair) {
      saveClientSideServerIdentityKeyPair(snapshot.hostKeyPair, {
        storage: window.localStorage,
        storageKey: storageKeys.keyPair,
      })
    }
    setStoredJson(storageKeys.knownHosts, snapshot.knownHosts)
    setStoredJson(storageKeys.authorityRecords, snapshot.authorityRecords)

    const hostKeyPair = snapshot.hostKeyPair ?? await getOrCreateClientSideServerIdentityKeyPair({
      storage: window.localStorage,
      storageKey: storageKeys.keyPair,
      keyId: snapshot.workspaceId,
    })
    const publicIdentity = await toClientSideServerPublicIdentity(hostKeyPair)

    set({
      hydratedWorkspaceId: snapshot.workspaceId,
      workspaceId: snapshot.workspaceId,
      serverName: snapshot.serverName,
      hostKeyPair,
      publicIdentity,
      knownHosts: sortKnownHosts(snapshot.knownHosts),
      authorityRecords: sortAuthorityRecords(snapshot.authorityRecords),
    })
    setSaveState(set)
  },
}))
