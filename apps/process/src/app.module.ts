import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EventsModule } from './events/events.module';
import { RedisModule } from './redis/redis.module';
import { RulesModule } from './rules/rules.module';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRoot(
            process.env.MONGO_URI || 'mongodb://localhost:27017/event_tracker',
        ),
        RedisModule,
        RulesModule,
        EventsModule,
    ],
})
export class AppModule { }
