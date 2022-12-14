import { BrowserAnimationsModule } from "@angular/platform-browser/animations"
import { BrowserModule } from '@angular/platform-browser'
import { FormsModule } from '@angular/forms'
import { NgModule } from '@angular/core'
import { AckModule, AckRouterModule } from 'ack-angular'
import { AppRoutingModule } from './app.routing.module'
import { AckComponentsModule } from 'ack-angular-components'

import { SessionProvider } from './session.provider'

import { AppComponent } from './app.component'
import declarations from './app.declarations'

@NgModule({
  declarations,
  imports: [
    BrowserAnimationsModule,
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    AckModule,
    AckRouterModule,
    AckComponentsModule,
  ],
  providers: [ SessionProvider ],
  bootstrap: [ AppComponent ]
})
export class AppModule { }
