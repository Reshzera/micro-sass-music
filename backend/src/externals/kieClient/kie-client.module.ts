import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KieClientService } from './kie-client.service';

@Module({
  imports: [ConfigModule],
  providers: [KieClientService],
  exports: [KieClientService],
})
export class KieClientModule {}
