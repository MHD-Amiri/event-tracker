import { checkCondition } from './pipeline.service';
import { RuleOperator } from '../rules/schemas/rule.schema';

describe('checkCondition() operator semantics', () => {
    const cases: [RuleOperator, number, number, boolean][] = [
        [RuleOperator.EQUALS, 42, 42, true],
        [RuleOperator.EQUALS, 42, 43, false],
        [RuleOperator.NOT_EQUALS, 42, 43, true],
        [RuleOperator.NOT_EQUALS, 42, 42, false],
        [RuleOperator.GREATER_THAN, 42, 41.9, true],
        [RuleOperator.GREATER_THAN, 42, 42, false],
        [RuleOperator.GREATER_THAN_OR_EQUAL, 42, 42, true],
        [RuleOperator.GREATER_THAN_OR_EQUAL, 42, 42.1, false],
        [RuleOperator.LESS_THAN, 42, 42.1, true],
        [RuleOperator.LESS_THAN, 42, 42, false],
        [RuleOperator.LESS_THAN_OR_EQUAL, 42, 42, true],
        [RuleOperator.LESS_THAN_OR_EQUAL, 42, 41.9, false],
    ];

    it.each(cases)('%s: checkCondition(%j, %j) → %j', (operator, value, target, expected) => {
        expect(checkCondition(value, operator, target)).toBe(expected);
    });

    it('returns false for an unknown operator', () => {
        expect(checkCondition(42, 'unknown' as RuleOperator, 42)).toBe(false);
    });
});
