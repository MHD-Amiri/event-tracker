import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { bootstrap } from './main';

jest.mock('@nestjs/core', () => ({
    NestFactory: { createApplicationContext: jest.fn() },
}));

describe('agent bootstrap', () => {
    const createApplicationContext = NestFactory.createApplicationContext as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('logs the broker failure details when the app context cannot initialize', async () => {
        const error = { code: 'ACCESS_REFUSED', message: 'RabbitMQ login was refused' };
        const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        createApplicationContext.mockRejectedValueOnce(error);

        await expect(bootstrap()).rejects.toBe(error);

        expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('ACCESS_REFUSED'));
        expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('RABBITMQ_URL'));
    });

    it('formats circular startup details without masking the original error', async () => {
        const error: Record<string, unknown> = { code: 'ACCESS_REFUSED' };
        error.cause = error;
        const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        createApplicationContext.mockRejectedValueOnce(error);

        await expect(bootstrap()).rejects.toBe(error);

        expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('[circular error detail]'));
    });
});
