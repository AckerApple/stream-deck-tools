import { get } from './app.utilities'
import packageJson from '../../package.json'
import { Component } from '@angular/core'

@Component({
  templateUrl: './debug.component.html',
})
export class DebugComponent {

  debugReport: any = {
    version: packageJson.version,
    navigator: navigator.userAgent,
    NL_OS: get('NL_OS'),
    NL_APPID: get('NL_APPID'),
    NL_PORT: get('NL_PORT'),
    NL_VERSION: get('NL_VERSION'),
    NL_CVERSION: get('NL_CVERSION'),
  }

  reportIssueLink = `https://github.com/AckerApple/stream-deck-tools/issues/new?title=app issue: &body=My issue is:${encodeURIComponent('\n\n\nMy debug info is:\n' + JSON.stringify(this.debugReport, null, 2))}`
}