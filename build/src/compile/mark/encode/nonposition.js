import { isConditionalDef } from '../../../channeldef';
import { getMarkPropOrConfig, signalOrValueRef } from '../../common';
import { wrapCondition } from './conditional';
import * as ref from './valueref';
import { getConditionalValueRefForIncludingInvalidValue } from './invalid';
/**
 * Return encode for non-positional channels with scales. (Text doesn't have scale.)
 */
export function nonPosition(channel, model, opt = {}) {
    const { markDef, encoding, config } = model;
    const { vgChannel } = opt;
    let { defaultRef, defaultValue } = opt;
    const channelDef = encoding[channel];
    if (defaultRef === undefined) {
        // prettier-ignore
        defaultValue ?? (defaultValue = getMarkPropOrConfig(channel, markDef, config, {
            vgChannel,
            // If there is no conditonal def, we ignore vgConfig so the output spec is concise.
            // However, if there is a conditional def, we must include vgConfig so the default is respected.
            ignoreVgConfig: !isConditionalDef(channelDef)
        }));
        if (defaultValue !== undefined) {
            defaultRef = signalOrValueRef(defaultValue);
        }
    }
    const commonProps = {
        markDef,
        config,
        scaleName: model.scaleName(channel),
        scale: model.getScaleComponent(channel)
    };
    const invalidValueRef = getConditionalValueRefForIncludingInvalidValue({
        ...commonProps,
        scaleChannel: channel,
        channelDef
    });
    const mainRefFn = (cDef) => {
        return ref.midPoint({
            ...commonProps,
            channel,
            channelDef: cDef,
            stack: null, // No need to provide stack for non-position as it does not affect mid point
            defaultRef
        });
    };
    return wrapCondition({
        model,
        channelDef,
        vgChannel: vgChannel ?? channel,
        invalidValueRef,
        mainRefFn
    });
}
//# sourceMappingURL=nonposition.js.map