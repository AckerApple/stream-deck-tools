import { Injectable } from "@angular/core"
import { getOs, getStorage, saveStorage } from "./app.utilities"
import { StreamDeck } from "./StreamDeck.class"

@Injectable()
export class SessionProvider {
  lastError?: Record<string, any>
  os = getOs()
  loading = 0

  streamdeck = new StreamDeck(this)

  // default localStorage
  config = {
  }

  constructor() {
    this.loadConfig()
  }

  async loadConfig() {
    try {
      const storage = await getStorage() as any
      const newConfig = storage || this.config
      
      fillGaps(newConfig, this.config)

      this.config = newConfig
    } catch (err) {
      this.error('could not load previous config', err)
    }
  }

  info(message: string): void {
    console.info('🔵 ' + message)
  }

  error<Err>(message: string, err?: Err): Err {
    this.lastError = Object.getOwnPropertyNames(err).reduce((a, key) => (a[key] = (err as any)[key]) && a || a, {} as any)
    console.error('🔴 ' + message, err)
    return err as Err
  }

  save() {
    saveStorage(this.config)
  }
}

function fillGaps (toFill: any, fillFrom: any) {
  // default to this.config for missing entries
  Object.keys(fillFrom).forEach(key => {
    if ( toFill[key] === undefined ) {
      toFill[key] = (fillFrom as any)[key]
    }

    if ( toFill[key] && typeof toFill[key] === 'object' ) {
      fillGaps(toFill[key], fillFrom[key])
    }
  })
}
