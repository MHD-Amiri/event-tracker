import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { RulesService } from './rules.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';

@Controller('rules')
export class RulesController {
    constructor(private readonly rulesService: RulesService) { }

    @Post()
    create(@Body() dto: CreateRuleDto) {
        return this.rulesService.create(dto);
    }

    @Get()
    findAll() {
        return this.rulesService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.rulesService.findOne(id);
    }

    @Put(':id')
    update(@Param('id') id: string, @Body() dto: UpdateRuleDto) {
        return this.rulesService.update(id, dto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.rulesService.remove(id);
    }
}
