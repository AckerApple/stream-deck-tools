import { Component } from '@angular/core'
import { DirectoryManager } from 'ack-angular-components/directory-managers/DirectoryManagers';
import { Device, ProfileAction } from '../elgato.types';
import { SessionProvider } from '../session.provider';
import { ProfileFolderManifestRead } from '../StreamDeck.class';

@Component({
  templateUrl: './navigate-devices.component.html',
})
export class NavigateDevicesComponent {
  devices: Device[] = []
  deviceViews: {
    device: Device
    currentProfile: ProfileFolderManifestRead
    buttons: ProfileAction[][]
  }[] = []

  constructor(public session: SessionProvider) {
    if ( session.streamdeck.dir ) {
      this.setDirectory(session.streamdeck.dir)
    }
  }

  async setDirectory(_dir: DirectoryManager) {
    ++this.session.loading
    this.devices = await this.session.streamdeck.fetchDevices()
    --this.session.loading
  }

  async addDevice(device: Device) {
    const currentProfile = await this.session.streamdeck.getProfileHomeDirByDeviceId(device.UUID)
    
    if ( !currentProfile ) {
      const err = new Error('Cannot find device home page')
      throw this.session.error(err.message, err)
    }

    const buttons: ProfileAction[][] = []
    const actions = currentProfile.manifest.Controllers[0].Actions

    Object.entries(actions).forEach(([key, action]) => {
      const targets = key.split(',').map((x: string) => Number(x))
      buttons[targets[1]] = buttons[targets[1]] || []
      buttons[targets[1]][targets[0]] = action
    })

    this.deviceViews.push({
      device, currentProfile, buttons
    })
  }
}