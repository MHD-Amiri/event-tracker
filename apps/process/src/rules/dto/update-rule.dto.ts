import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { RuleOperator } from '../schemas/rule.schema';

export class UpdateRuleDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    eventName?: string;

    @IsEnum(RuleOperator)
    @IsOptional()
    operator?: RuleOperator;

    @IsNumber()
    @IsOptional()
    value?: number;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;
}
