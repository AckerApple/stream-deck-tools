import { NgModule } from '@angular/core'
import { MenuComponent } from './menu.component'
import { Route, RouterModule, Routes } from '@angular/router'

import { FixProfilesNavComponent } from './profiles/fix-profiles-nav.component'
import { CompareDevicesComponent } from './compare/compare-devices.component'
import { NavigateDevicesComponent } from './compare/navigate-devices.component'

export const fixProfilesNav: Route = {
  path: 'fix-profiles-nav',
  title: 'Fix Profiles Nav',
  component: FixProfilesNavComponent,
  data: {
    emoji: '↔️',
    description: 'When you copy/paste profiles navigation across profiles can become broken',
    wrapClass: 'bg-black radius-25 pad-2x'
  }
}

export const compareDevices: Route = {
  path: 'compare-devices',
  title: 'Compare Devices',
  component: CompareDevicesComponent,
  data: {
    emoji: '🔦',
    description: 'Help for when you have two or more devices on one machine and want to sync profiles or entire devices.',
    wrapClass: 'bg-black radius-25 pad-2x'
  }
}

export const navigateDevices: Route = {
  path: 'navigate-devices',
  title: 'Navigate Devices',
  component: NavigateDevicesComponent,
  data: {
    emoji: '🧭',
    description: 'Navigate with stream deck multiple screens',
    wrapClass: 'bg-black radius-25 pad-2x'
  }
}

export const menu = [fixProfilesNav, compareDevices, navigateDevices,]

export const subRoutes: Route[] = [
  ...menu,
  {
    path: 'menu',
    title: 'main menu',
    data: {
      emoji: '⠇',
    },
    component: MenuComponent,
  }
]

const routes: Routes = [
  ...subRoutes,
  {path: '',   redirectTo: 'menu', pathMatch: 'full' },//default route
  {path: '**',   redirectTo: 'menu' }//404
]

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
