import { Pipe } from '@angular/core'
import { DirectoryManager } from 'ack-angular-components/directory-managers/DirectoryManagers'
import { Subject } from 'rxjs'

@Pipe({name: 'loadDirImage'}) export class LoadDirImage {
  transform({ dir, imagePath }: {
    dir: DirectoryManager,
    imagePath: string
  }): Subject<string> {
    const subject = new Subject<string>()

    async function run() {
      const image = await dir.findFileByPath(imagePath)
  
      if ( !image ) {
        return
      }
  

      subject.next(await image.readAsDataURL())
    }

    run()
    return subject
  }
}


export const pipes = [
  LoadDirImage
]

export default pipes