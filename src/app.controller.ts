import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: this.config.get<string>('OTEL_SERVICE_NAME') ?? 'soat-api',
      version: this.config.get<string>('OTEL_SERVICE_VERSION') ?? 'local',
    };
  }
}
