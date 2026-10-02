import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { PageRenderService } from './page-render.service';

@UseGuards(JwtAuthGuard)
@Controller('api/file-versions')
export class PageRenderController {
  constructor(private readonly svc: PageRenderService) {}

  @Get(':id/pages/:page')
  async page(
    @Param('id') id: string,
    @Param('page') page: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const rendered = await this.svc.render(id, page, req.session?.userId);
    res.setHeader('Content-Type', rendered.contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(200).send(rendered.body);
  }
}
