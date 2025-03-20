import { isNumber, isObject } from 'vega-util';
import { getMarkPropOrConfig } from '../compile/common';
import { extractTransformsFromEncoding, normalizeEncoding } from '../encoding';
import * as log from '../log';
import { isMarkDef } from '../mark';
import { accessWithDatumToUnescapedPath, isEmpty, omit, removePathFromField } from '../util';
import { CompositeMarkNormalizer } from './base';
import { compositeMarkContinuousAxis, compositeMarkOrient, filterTooltipWithAggregatedField, getCompositeMarkTooltip, getTitle, makeCompositeAggregatePartFactory, partLayerMixins } from './common';
export const BOXPLOT = 'boxplot';
export const BOXPLOT_PARTS = ['box', 'median', 'outliers', 'rule', 'ticks'];
export const boxPlotNormalizer = new CompositeMarkNormalizer(BOXPLOT, normalizeBoxPlot);
export function getBoxPlotType(extent) {
    if (isNumber(extent)) {
        return 'tukey';
    }
    // Ham: If we ever want to, we could add another extent syntax `{kIQR: number}` for the original [Q1-k*IQR, Q3+k*IQR] whisker and call this boxPlotType = `kIQR`. However, I'm not exposing this for now.
    return extent;
}
export function normalizeBoxPlot(spec, { config }) {
    // Need to initEncoding first so we can infer type
    spec = {
        ...spec,
        encoding: normalizeEncoding(spec.encoding, config)
    };
    const { mark, encoding: _encoding, params, projection: _p, ...outerSpec } = spec;
    const markDef = isMarkDef(mark) ? mark : { type: mark };
    // TODO(https://github.com/vega/vega-lite/issues/3702): add selection support
    if (params) {
        log.warn(log.message.selectionNotSupported('boxplot'));
    }
    const extent = markDef.extent ?? config.boxplot.extent;
    const sizeValue = getMarkPropOrConfig('size', markDef, // TODO: https://github.com/vega/vega-lite/issues/6245
    config);
    const invalid = markDef.invalid;
    const boxPlotType = getBoxPlotType(extent);
    const { bins, timeUnits, transform, continuousAxisChannelDef, continuousAxis, groupby, aggregate, encodingWithoutContinuousAxis, ticksOrient, boxOrient, customTooltipWithoutAggregatedField } = boxParams(spec, extent, config);
    const aliasedFieldName = removePathFromField(continuousAxisChannelDef.field);
    const { color, size, ...encodingWithoutSizeColorAndContinuousAxis } = encodingWithoutContinuousAxis;
    const makeBoxPlotPart = (sharedEncoding) => {
        return makeCompositeAggregatePartFactory(markDef, continuousAxis, continuousAxisChannelDef, sharedEncoding, config.boxplot);
    };
    const makeBoxPlotExtent = makeBoxPlotPart(encodingWithoutSizeColorAndContinuousAxis);
    const makeBoxPlotBox = makeBoxPlotPart(encodingWithoutContinuousAxis);
    const defaultBoxColor = (isObject(config.boxplot.box) ? config.boxplot.box.color : config.mark.color) || '#4c78a8';
    const makeBoxPlotMidTick = makeBoxPlotPart({
        ...encodingWithoutSizeColorAndContinuousAxis,
        ...(size ? { size } : {}),
        color: {
            condition: {
                test: `${accessWithDatumToUnescapedPath(`lower_box_${continuousAxisChannelDef.field}`)} >= ${accessWithDatumToUnescapedPath(`upper_box_${continuousAxisChannelDef.field}`)}`,
                ...(color || { value: defaultBoxColor })
            }
        }
    });
    const fiveSummaryTooltipEncoding = getCompositeMarkTooltip([
        { fieldPrefix: boxPlotType === 'min-max' ? 'upper_whisker_' : 'max_', titlePrefix: 'Max' },
        { fieldPrefix: 'upper_box_', titlePrefix: 'Q3' },
        { fieldPrefix: 'mid_box_', titlePrefix: 'Median' },
        { fieldPrefix: 'lower_box_', titlePrefix: 'Q1' },
        { fieldPrefix: boxPlotType === 'min-max' ? 'lower_whisker_' : 'min_', titlePrefix: 'Min' }
    ], continuousAxisChannelDef, encodingWithoutContinuousAxis);
    // ## Whisker Layers
    const endTick = { type: 'tick', color: 'black', opacity: 1, orient: ticksOrient, invalid, aria: false };
    const whiskerTooltipEncoding = boxPlotType === 'min-max'
        ? fiveSummaryTooltipEncoding // for min-max, show five-summary tooltip for whisker
        : // for tukey / k-IQR, just show upper/lower-whisker
            getCompositeMarkTooltip([
                { fieldPrefix: 'upper_whisker_', titlePrefix: 'Upper Whisker' },
                { fieldPrefix: 'lower_whisker_', titlePrefix: 'Lower Whisker' }
            ], continuousAxisChannelDef, encodingWithoutContinuousAxis);
    const whiskerLayers = [
        ...makeBoxPlotExtent({
            partName: 'rule',
            mark: { type: 'rule', invalid, aria: false },
            positionPrefix: 'lower_whisker',
            endPositionPrefix: 'lower_box',
            extraEncoding: whiskerTooltipEncoding
        }),
        ...makeBoxPlotExtent({
            partName: 'rule',
            mark: { type: 'rule', invalid, aria: false },
            positionPrefix: 'upper_box',
            endPositionPrefix: 'upper_whisker',
            extraEncoding: whiskerTooltipEncoding
        }),
        ...makeBoxPlotExtent({
            partName: 'ticks',
            mark: endTick,
            positionPrefix: 'lower_whisker',
            extraEncoding: whiskerTooltipEncoding
        }),
        ...makeBoxPlotExtent({
            partName: 'ticks',
            mark: endTick,
            positionPrefix: 'upper_whisker',
            extraEncoding: whiskerTooltipEncoding
        })
    ];
    // ## Box Layers
    // TODO: support hiding certain mark parts
    const boxLayers = [
        ...(boxPlotType !== 'tukey' ? whiskerLayers : []),
        ...makeBoxPlotBox({
            partName: 'box',
            mark: {
                type: 'bar',
                ...(sizeValue ? { size: sizeValue } : {}),
                orient: boxOrient,
                invalid,
                ariaRoleDescription: 'box'
            },
            positionPrefix: 'lower_box',
            endPositionPrefix: 'upper_box',
            extraEncoding: fiveSummaryTooltipEncoding
        }),
        ...makeBoxPlotMidTick({
            partName: 'median',
            mark: {
                type: 'tick',
                invalid,
                ...(isObject(config.boxplot.median) && config.boxplot.median.color ? { color: config.boxplot.median.color } : {}),
                ...(sizeValue ? { size: sizeValue } : {}),
                orient: ticksOrient,
                aria: false
            },
            positionPrefix: 'mid_box',
            extraEncoding: fiveSummaryTooltipEncoding
        })
    ];
    if (boxPlotType === 'min-max') {
        return {
            ...outerSpec,
            transform: (outerSpec.transform ?? []).concat(transform),
            layer: boxLayers
        };
    }
    // Tukey Box Plot
    const lowerBoxExpr = accessWithDatumToUnescapedPath(`lower_box_${continuousAxisChannelDef.field}`);
    const upperBoxExpr = accessWithDatumToUnescapedPath(`upper_box_${continuousAxisChannelDef.field}`);
    const iqrExpr = `(${upperBoxExpr} - ${lowerBoxExpr})`;
    const lowerWhiskerExpr = `${lowerBoxExpr} - ${extent} * ${iqrExpr}`;
    const upperWhiskerExpr = `${upperBoxExpr} + ${extent} * ${iqrExpr}`;
    const fieldExpr = accessWithDatumToUnescapedPath(continuousAxisChannelDef.field);
    const joinaggregateTransform = {
        joinaggregate: boxParamsQuartiles(continuousAxisChannelDef.field),
        groupby
    };
    const filteredWhiskerSpec = {
        transform: [
            {
                filter: `(${lowerWhiskerExpr} <= ${fieldExpr}) && (${fieldExpr} <= ${upperWhiskerExpr})`
            },
            {
                aggregate: [
                    {
                        op: 'min',
                        field: continuousAxisChannelDef.field,
                        as: `lower_whisker_${aliasedFieldName}`
                    },
                    {
                        op: 'max',
                        field: continuousAxisChannelDef.field,
                        as: `upper_whisker_${aliasedFieldName}`
                    },
                    // preserve lower_box / upper_box
                    {
                        op: 'min',
                        field: `lower_box_${continuousAxisChannelDef.field}`,
                        as: `lower_box_${aliasedFieldName}`
                    },
                    {
                        op: 'max',
                        field: `upper_box_${continuousAxisChannelDef.field}`,
                        as: `upper_box_${aliasedFieldName}`
                    },
                    ...aggregate
                ],
                groupby
            }
        ],
        layer: whiskerLayers
    };
    const { tooltip, ...encodingWithoutSizeColorContinuousAxisAndTooltip } = encodingWithoutSizeColorAndContinuousAxis;
    const { scale, axis } = continuousAxisChannelDef;
    const title = getTitle(continuousAxisChannelDef);
    const axisWithoutTitle = omit(axis, ['title']);
    const outlierLayersMixins = partLayerMixins(markDef, 'outliers', config.boxplot, {
        transform: [{ filter: `(${fieldExpr} < ${lowerWhiskerExpr}) || (${fieldExpr} > ${upperWhiskerExpr})` }],
        mark: 'point',
        encoding: {
            [continuousAxis]: {
                field: continuousAxisChannelDef.field,
                type: continuousAxisChannelDef.type,
                ...(title !== undefined ? { title } : {}),
                ...(scale !== undefined ? { scale } : {}),
                // add axis without title since we already added the title above
                ...(isEmpty(axisWithoutTitle) ? {} : { axis: axisWithoutTitle })
            },
            ...encodingWithoutSizeColorContinuousAxisAndTooltip,
            ...(color ? { color } : {}),
            ...(customTooltipWithoutAggregatedField ? { tooltip: customTooltipWithoutAggregatedField } : {})
        }
    })[0];
    let filteredLayersMixins;
    const filteredLayersMixinsTransforms = [...bins, ...timeUnits, joinaggregateTransform];
    if (outlierLayersMixins) {
        filteredLayersMixins = {
            transform: filteredLayersMixinsTransforms,
            layer: [outlierLayersMixins, filteredWhiskerSpec]
        };
    }
    else {
        filteredLayersMixins = filteredWhiskerSpec;
        filteredLayersMixins.transform.unshift(...filteredLayersMixinsTransforms);
    }
    return {
        ...outerSpec,
        layer: [
            filteredLayersMixins,
            {
                // boxplot
                transform,
                layer: boxLayers
            }
        ]
    };
}
function boxParamsQuartiles(continousAxisField) {
    const aliasedFieldName = removePathFromField(continousAxisField);
    return [
        {
            op: 'q1',
            field: continousAxisField,
            as: `lower_box_${aliasedFieldName}`
        },
        {
            op: 'q3',
            field: continousAxisField,
            as: `upper_box_${aliasedFieldName}`
        }
    ];
}
function boxParams(spec, extent, config) {
    const orient = compositeMarkOrient(spec, BOXPLOT);
    const { continuousAxisChannelDef, continuousAxis } = compositeMarkContinuousAxis(spec, orient, BOXPLOT);
    const continuousFieldName = continuousAxisChannelDef.field;
    const aliasedFieldName = removePathFromField(continuousFieldName);
    const boxPlotType = getBoxPlotType(extent);
    const boxplotSpecificAggregate = [
        ...boxParamsQuartiles(continuousFieldName),
        {
            op: 'median',
            field: continuousFieldName,
            as: `mid_box_${aliasedFieldName}`
        },
        {
            op: 'min',
            field: continuousFieldName,
            as: (boxPlotType === 'min-max' ? 'lower_whisker_' : 'min_') + aliasedFieldName
        },
        {
            op: 'max',
            field: continuousFieldName,
            as: (boxPlotType === 'min-max' ? 'upper_whisker_' : 'max_') + aliasedFieldName
        }
    ];
    const postAggregateCalculates = boxPlotType === 'min-max' || boxPlotType === 'tukey'
        ? []
        : [
            // This is for the  original k-IQR, which we do not expose
            {
                calculate: `${accessWithDatumToUnescapedPath(`upper_box_${aliasedFieldName}`)} - ${accessWithDatumToUnescapedPath(`lower_box_${aliasedFieldName}`)}`,
                as: `iqr_${aliasedFieldName}`
            },
            {
                calculate: `min(${accessWithDatumToUnescapedPath(`upper_box_${aliasedFieldName}`)} + ${accessWithDatumToUnescapedPath(`iqr_${aliasedFieldName}`)} * ${extent}, ${accessWithDatumToUnescapedPath(`max_${aliasedFieldName}`)})`,
                as: `upper_whisker_${aliasedFieldName}`
            },
            {
                calculate: `max(${accessWithDatumToUnescapedPath(`lower_box_${aliasedFieldName}`)} - ${accessWithDatumToUnescapedPath(`iqr_${aliasedFieldName}`)} * ${extent}, ${accessWithDatumToUnescapedPath(`min_${aliasedFieldName}`)})`,
                as: `lower_whisker_${aliasedFieldName}`
            }
        ];
    const { [continuousAxis]: oldContinuousAxisChannelDef, ...oldEncodingWithoutContinuousAxis } = spec.encoding;
    const { customTooltipWithoutAggregatedField, filteredEncoding } = filterTooltipWithAggregatedField(oldEncodingWithoutContinuousAxis);
    const { bins, timeUnits, aggregate, groupby, encoding: encodingWithoutContinuousAxis } = extractTransformsFromEncoding(filteredEncoding, config);
    const ticksOrient = orient === 'vertical' ? 'horizontal' : 'vertical';
    const boxOrient = orient;
    const transform = [
        ...bins,
        ...timeUnits,
        {
            aggregate: [...aggregate, ...boxplotSpecificAggregate],
            groupby
        },
        ...postAggregateCalculates
    ];
    return {
        bins,
        timeUnits,
        transform,
        groupby,
        aggregate,
        continuousAxisChannelDef,
        continuousAxis,
        encodingWithoutContinuousAxis,
        ticksOrient,
        boxOrient,
        customTooltipWithoutAggregatedField
    };
}
//# sourceMappingURL=boxplot.js.map