export class CircuitBreaker {
  constructor() {
    this.trippedProviders = new Set();
  }

  tripProvider(providerId) {
    this.trippedProviders.add(providerId);
  }

  resetProvider(providerId) {
    this.trippedProviders.delete(providerId);
  }

  isProviderTripped(providerId) {
    return this.trippedProviders.has(providerId);
  }
}
