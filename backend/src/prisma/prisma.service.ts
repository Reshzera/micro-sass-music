import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Owns the single `PrismaClient` for the process.
 *
 * Prisma 7 talks to Postgres through a driver adapter rather than a bundled
 * engine, so the connection string is handed over at construction time.
 * Nest tears the pool down on shutdown via `OnModuleDestroy`.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const connectionString = config.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set. Add it to your environment before starting the API.',
      );
    }

    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to Postgres');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
