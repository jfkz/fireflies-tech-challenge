import { Controller, Get, Header } from '@nestjs/common';
import type { LatestDownload } from '@boringtalks/shared';
import { Public } from '../auth/auth.decorators';
import { DownloadsService } from './downloads.service';

@Controller('downloads')
export class DownloadsController {
  constructor(private readonly downloads: DownloadsService) {}

  @Get('latest')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  latest(): Promise<LatestDownload> {
    return this.downloads.latest();
  }
}
