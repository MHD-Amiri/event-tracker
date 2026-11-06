import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    console.log(`🤖 Agent service initialized successfully!`);
}
bootstrap();
