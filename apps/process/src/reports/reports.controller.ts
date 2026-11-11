import { Controller, Get, Query, Param } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
    constructor(private readonly reportsService: ReportsService) { }

    // GET /reports/rules/:ruleId/timestamps?start=2026-11-07T00:00:00Z&end=2026-11-07T12:00:00Z
    @Get('rules/:ruleId/timestamps')
    async getTimestamps(
        @Param('ruleId') ruleId: string,
        @Query('start') start: string,
        @Query('end') end: string,
        @Query('limit') limit?: string,
        @Query('cursor') cursor?: string,
    ) {
        return this.reportsService.getAgentTimestamps(ruleId, start, end, limit, cursor);
    }

    // GET /reports/rules/:ruleId/ranking
    @Get('rules/:ruleId/ranking')
    async getRanking(@Param('ruleId') ruleId: string) {
        return this.reportsService.getAgentRanking(ruleId);
    }
}
