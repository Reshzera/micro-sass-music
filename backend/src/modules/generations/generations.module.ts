import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KieClientModule } from '../../externals/kieClient/kie-client.module';
import { GenerationsController } from './generations.controller';
import { GenerationsRepository } from './generations.repository';
import { GenerationsService } from './generations.service';

@Module({
  imports: [ConfigModule, KieClientModule],
  controllers: [GenerationsController],
  providers: [GenerationsService, GenerationsRepository],
  exports: [GenerationsService],
})
export class GenerationsModule {}
