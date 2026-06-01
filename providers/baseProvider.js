class BaseProvider {
  constructor(target, onMessage) {
    if (new.target === BaseProvider) {
      throw new Error('BaseProvider is an abstract class and cannot be instantiated directly.');
    }

    this.target = target;
    this.onMessage = onMessage;
    this.isActive = false;
  }

  start() {
    this.isActive = true;
  }

  stop() {
    this.isActive = false;
  }
}

module.exports = BaseProvider;
