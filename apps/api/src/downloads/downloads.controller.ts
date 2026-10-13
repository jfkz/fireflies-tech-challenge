import { Controller, Get, Header, Param } from '@nestjs/common';
import type { Downloads, LatestDownload } from '@boringtalks/shared';
import { Public } from '../auth/auth.decorators';
import { DownloadsService } from './downloads.service';

@Controller('downloads')
export class DownloadsController {
  constructor(private readonly downloads: DownloadsService) {}

  /** The latest build for every platform, `null` where none has shipped yet. */
  @Get()
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  all(): Promise<Downloads> {
    return this.downloads.all();
  }

  /** The latest Mac build. Kept from before the Windows app; `/downloads` has both. */
  @Get('latest')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  latest(): Promise<LatestDownload> {
    return this.downloads.latest('macos');
  }

  @Get('latest/:platform')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  latestFor(@Param('platform') platform: string): Promise<LatestDownload> {
    return this.downloads.latest(platform);
  }
}
