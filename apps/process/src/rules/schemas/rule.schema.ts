import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RuleDocument = Rule & Document;

export enum RuleOperator {
    EQUALS = '==',
    NOT_EQUALS = '!=',
    GREATER_THAN = '>',
    GREATER_THAN_OR_EQUAL = '>=',
    LESS_THAN = '<',
    LESS_THAN_OR_EQUAL = '<=',
}

@Schema({ timestamps: true })
export class Rule {
    @Prop({ required: true, trim: true })
    name: string;

    @Prop({ required: true, index: true, trim: true })
    eventName: string;

    @Prop({ required: true, enum: RuleOperator })
    operator: RuleOperator;

    @Prop({ required: true, type: Number })
    value: number;

    @Prop({ default: true, index: true })
    isActive: boolean;
}

export const RuleSchema = SchemaFactory.createForClass(Rule);
