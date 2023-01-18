import { DirectoryManager, DmFileReader } from 'ack-angular-components/directory-managers/DirectoryManagers'
import { Actions, DeviceProfile, ProfileFolderManifest } from '../elgato.types'
import { ProfileManifestRead } from '../StreamDeck.class'

export interface Compare {
  compareType: 'not-in-from' | 'not-in-with'
  itemType: 'profile' | 'controlAction'

  // ❌ cannot be solved (we cant generate the folder ids elgato uses)
  notInProfile?: NotInProfile

  // ✅ can be solved. Existing profiles on both sides, just missing action
  notInActions?: NotInActions
}

export interface NotInProfile {
  file: DmFileReader // existing manifest file
  manifest: DeviceProfile // existing manifest {Name: string}
}

export interface NotInProfileCompare extends Compare {
  itemType: 'profile'
  notInProfile: NotInProfile
}

export interface NotInActions {
  notInFile: DmFileReader // manifest file missing control.action
  manifest: ProfileFolderManifest // manifest missing control.action

  actions: Actions
  inProfileDir: DirectoryManager // the directory we are coming FROM so we can grab images
  
  // missing in profile parent details
  profileParent: ProfileManifestRead
}

export interface NotInActionsCompare extends Compare {
  itemType: 'controlAction'
  notInActions: NotInActions
}
