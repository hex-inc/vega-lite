import { isScaleChannel } from '../../channel';
import { vgField as fieldRef } from '../../channeldef';
import { hash, keys } from '../../util';
import { getScaleInvalidDataMode } from '../invalid/ScaleInvalidDataMode';
import { DataFlowNode } from './dataflow';
import { isCountingAggregateOp } from '../../aggregate';
export class FilterInvalidNode extends DataFlowNode {
    clone() {
        return new FilterInvalidNode(null, { ...this.filter });
    }
    constructor(parent, filter) {
        super(parent);
        this.filter = filter;
    }
    static make(parent, model, dataSourcesForHandlingInvalidValues) {
        const { config, markDef } = model;
        const { marks, scales } = dataSourcesForHandlingInvalidValues;
        if (marks === 'include-invalid-values' && scales === 'include-invalid-values') {
            // If neither marks nor scale domains need data source to filter null values, then don't add the filter.
            return null;
        }
        const filter = model.reduceFieldDef((aggregator, fieldDef, channel) => {
            const scaleComponent = isScaleChannel(channel) && model.getScaleComponent(channel);
            if (scaleComponent) {
                const scaleType = scaleComponent.get('type');
                const { aggregate } = fieldDef;
                const invalidDataMode = getScaleInvalidDataMode({
                    scaleChannel: channel,
                    markDef,
                    config,
                    scaleType,
                    isCountAggregate: isCountingAggregateOp(aggregate)
                });
                // If the invalid data mode is include or always-valid, we don't need to filter invalid values as the scale can handle invalid values.
                if (invalidDataMode !== 'show' && invalidDataMode !== 'always-valid') {
                    aggregator[fieldDef.field] = fieldDef; // we know that the fieldDef is a typed field def
                }
            }
            return aggregator;
        }, {});
        if (!keys(filter).length) {
            return null;
        }
        return new FilterInvalidNode(parent, filter);
    }
    dependentFields() {
        return new Set(keys(this.filter));
    }
    producedFields() {
        return new Set(); // filter does not produce any new fields
    }
    hash() {
        return `FilterInvalid ${hash(this.filter)}`;
    }
    /**
     * Create the VgTransforms for each of the filtered fields.
     */
    assemble() {
        const filters = keys(this.filter).reduce((vegaFilters, field) => {
            const fieldDef = this.filter[field];
            const ref = fieldRef(fieldDef, { expr: 'datum' });
            if (fieldDef !== null) {
                if (fieldDef.type === 'temporal') {
                    vegaFilters.push(`(isDate(${ref}) || (${isValidFiniteNumberExpr(ref)}))`);
                }
                else if (fieldDef.type === 'quantitative') {
                    vegaFilters.push(isValidFiniteNumberExpr(ref));
                }
                else {
                    // should never get here
                }
            }
            return vegaFilters;
        }, []);
        return filters.length > 0
            ? {
                type: 'filter',
                expr: filters.join(' && ')
            }
            : null;
    }
}
export function isValidFiniteNumberExpr(ref) {
    return `isValid(${ref}) && isFinite(+${ref})`;
}
//# sourceMappingURL=filterinvalid.js.map