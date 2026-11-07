import { IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { RuleOperator } from '../schemas/rule.schema';

export class CreateRuleDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsNotEmpty()
    eventName: string;

    @IsEnum(RuleOperator)
    operator: RuleOperator;

    @IsNumber()
    value: number;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;
}
