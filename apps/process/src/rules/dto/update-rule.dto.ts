import { IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsString, ValidateIf } from 'class-validator';
import { RuleOperator } from '../schemas/rule.schema';

export class UpdateRuleDto {
    @IsString()
    @IsNotEmpty()
    @ValidateIf((_object, value) => value !== undefined)
    name?: string;

    @IsString()
    @IsNotEmpty()
    @ValidateIf((_object, value) => value !== undefined)
    eventName?: string;

    @IsEnum(RuleOperator)
    @ValidateIf((_object, value) => value !== undefined)
    operator?: RuleOperator;

    @IsNumber({ allowNaN: false, allowInfinity: false })
    @ValidateIf((_object, value) => value !== undefined)
    value?: number;

    @IsBoolean()
    @ValidateIf((_object, value) => value !== undefined)
    isActive?: boolean;
}
