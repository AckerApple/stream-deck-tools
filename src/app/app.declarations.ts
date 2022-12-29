import { AppComponent } from './app.component'
import { DebugComponent } from './debug.component'

import { FixProfilesNavComponent } from './profiles/fix-profiles-nav.component'
import { CompareDevicesComponent } from './compare/compare-devices.component'

import { MenuComponent } from './menu.component'

import { MenuStackListComponent } from './menu-stack-list.component'
import { ExitComponent } from './exit.component'
import { SelectElgatoSessionDirectoryComponent } from './select-elgato-session-directory.component'
import { NavigateDevicesComponent } from './compare/navigate-devices.component'
import pipes from './app.pipes'
import { PageButtonsComponent } from './compare/page-buttons.component'
import { PageButtonComponent } from './compare/page-button.component'

export const declarations = [
  AppComponent,
  
  MenuComponent,
  PageButtonsComponent,
  PageButtonComponent,
  DebugComponent,
  SelectElgatoSessionDirectoryComponent,
  
  NavigateDevicesComponent,
  FixProfilesNavComponent,
  CompareDevicesComponent,
  MenuStackListComponent,
  ExitComponent,
  ...pipes,
]

export default declarations