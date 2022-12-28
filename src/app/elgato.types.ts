export interface Device {
  Model:string
  UUID:string
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
}

export interface ProfileAction {
  Name: string
  Settings: {
    ProfileUUID: string
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
