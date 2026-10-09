import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KieClientModule } from '../../externals/kieClient/kie-client.module';
import { GenerationsController } from './generations.controller';
import { GenerationsService } from './generations.service';

@Module({
  imports: [ConfigModule, KieClientModule],
  controllers: [GenerationsController],
  providers: [GenerationsService],
  exports: [GenerationsService],
})
export class GenerationsModule {}
