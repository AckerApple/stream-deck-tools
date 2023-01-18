export interface Device {
  Model: string
  UUID: string
}

export interface DeviceProfile {
  Device: Device
  Name: string
  Pages: {
    Current: string
    Pages: string[]
  },
  Version: string
}

export interface State {
  Image: string
  ShowTitle?: boolean
  Title?: string
  TitleAlignment?: string
  FontSize?: number
}

export interface ProfileAction {
  Name: string
  Settings: {
    ProfileUUID: string
    DeviceUUID: string
    PageIndex: number

    // browser settings examples
    openInBrowser?: boolean
    path?: string // "http://localhost:3030/"
  }
  States: State[]
  Actions?: ProfileAction[]
  UUID: string
}

export interface Actions {
  [position: string]: ProfileAction
}

export interface ProfileFolderManifest {
  Controllers: {
    Actions: Actions
  }[]
}
