import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GenerationsModule } from './modules/generations/generations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    GenerationsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
