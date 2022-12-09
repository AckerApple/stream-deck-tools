import { NgModule } from '@angular/core'
import { MenuComponent } from './menu.component'
import { Route, RouterModule, Routes } from '@angular/router'
import { FixProfilesNavComponent } from './profiles/fix-profiles-nav.component'

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

export const menu: Route[] = [
  fixProfilesNav,
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
  ...menu,
  {path: '',   redirectTo: 'menu', pathMatch: 'full' },//default route
  {path: '**',   redirectTo: 'menu' }//404
]

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
