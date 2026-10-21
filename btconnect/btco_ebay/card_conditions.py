"""Validate selected descriptors against fresh eBay category metadata."""

def validate_descriptors(condition, selected):
    definitions = condition.get('conditionDescriptors', [])
    by_id = {d['conditionDescriptorId']: d for d in definitions}
    choices = {d.name: d for d in selected}
    if len(by_id) != len(definitions) or not definitions:
        raise ValueError('Card condition metadata is incomplete')
    if condition.get('usage') not in (None, 'RECOMMENDED', 'REQUIRED', 'OPTIONAL'):
        raise ValueError('Card condition eligibility requires review')
    for identifier, definition in by_id.items():
        constraint = definition.get('conditionDescriptorConstraint', {})
        if constraint.get('usage') == 'REQUIRED' and identifier not in choices:
            raise ValueError('A required card condition descriptor is missing')
    for identifier, choice in choices.items():
        definition = by_id.get(identifier)
        if not definition:
            raise ValueError('Selected card condition descriptor is unavailable')
        constraint = definition.get('conditionDescriptorConstraint', {})
        if choice.additionalInfo:
            if constraint.get('mode') != 'FREE_TEXT' or len(choice.additionalInfo) > constraint.get('maxLength', 30):
                raise ValueError('Certification number does not meet category requirements')
        else:
            values = {v['conditionDescriptorValueId']: v for v in definition.get('conditionDescriptorValues', [])}
            value = values.get(choice.values[0])
            if value is None:
                raise ValueError('Selected grade or condition is unavailable')
            for rule in value.get('conditionDescriptorValueConstraints', []):
                other = choices.get(rule.get('applicableToConditionDescriptorId'))
                allowed = rule.get('applicableToConditionDescriptorValueIds', [])
                if other is None or not other.values or other.values[0] not in allowed:
                    raise ValueError('Selected grade is not supported for this grader')


def validate_card_shipping(policies, draft):
    from decimal import Decimal
    services = [s for option in policies.get('fulfillment_policy', {}).get('shippingOptions', [])
                for s in option.get('shippingServices', [])]
    if any('ebaystandardenvelope' in s.get('shippingServiceCode', '').lower().replace('_','') for s in services):
        if draft.condition == 'LIKE_NEW' or Decimal(draft.price_usd) > 20:
            raise ValueError('Slabs and cards above $20 require a bubble-mailer shipping policy, not eBay Standard Envelope')
