import { Component } from '@angular/core'
import packageJson from '../../package.json'
import { SessionProvider } from './session.provider'


@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  version = packageJson.version
  window = window as any // for in-template check of available functionality AND for its any typing in `this` component

  constructor(
    public session: SessionProvider,
  ) {
  }
}
