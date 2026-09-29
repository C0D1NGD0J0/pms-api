import { Types } from 'mongoose';
import { Subscription } from '@models/index';

// subscription.service reads subscription.resourceTracker.* / seats.* without null guards.
// That is safe because Mongoose applies schema defaults when it hydrates a stored document
// (the same init path findOne/find use), so legacy documents saved before these fields
// existed never surface them as undefined. Note: .lean() results do NOT get defaults.
describe('Subscription model — defaults on legacy documents', () => {
  const legacyDocument = {
    _id: new Types.ObjectId(),
    cuid: 'LEGACY1',
    currentSeats: 3,
    currentProperties: 2,
    additionalSeatsCount: 1,
  };

  it('fills resourceTracker counters with 0 when the stored document has none', () => {
    const subscription: any = Subscription.hydrate(legacyDocument);

    expect(subscription.resourceTracker.propertyCount).toBe(0);
    expect(subscription.resourceTracker.unitCount).toBe(0);
    expect(subscription.resourceTracker.seatCount).toBe(0);
  });

  it('fills seats with 0 when the stored document has none', () => {
    const subscription: any = Subscription.hydrate(legacyDocument);

    expect(subscription.seats.additional).toBe(0);
    expect(subscription.seats.additionalCost).toBe(0);
  });
});
