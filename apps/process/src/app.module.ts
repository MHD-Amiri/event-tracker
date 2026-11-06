import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EventsModule } from './events/events.module';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRoot(
            process.env.MONGO_URI || 'mongodb://localhost:27017/event_tracker',
        ),
        EventsModule,
    ],
})
export class AppModule { }
