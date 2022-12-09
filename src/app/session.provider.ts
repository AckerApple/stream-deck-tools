import { EventEmitter, Injectable } from "@angular/core"
import { getOs, getStorage, saveStorage } from "./app.utilities"

@Injectable()
export class SessionProvider {
  lastError?: Record<string, any>
  os = getOs()

  config = {
    xarcadeXinput: {
      path: this.os === 'Darwin' ? '' : (this.os ? 'C:\\Users\\Administrator\\LaunchBox\\Tools\\xarcade-xinput' : ''),
    },
    launchBox: {
      path: this.os === 'Darwin' ? '' : (this.os ? 'C:\\Users\\Administrator\\LaunchBox\\' : ''),
      dataFolderName: 'Data',
      bigBoxFileName: 'BigBoxSettings.xml'
    },
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

  error(message: string, err?: any) {
    this.lastError = Object.getOwnPropertyNames(err).reduce((a, key) => (a[key] = err[key]) && a || a, {} as any)
    console.error('🔴 ' + message, err)
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
