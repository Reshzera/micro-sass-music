import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GenerationsModule } from './modules/generations/generations.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    GenerationsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
