document.addEventListener('alpine:init', () => {
  Alpine.data('tvmCalculator', () => ({
    paymentsPerYear: 12,
    timing: 'END',
    values: { n: '', rate: '', pv: '', pmt: '', fv: '' },
    result: null,
    message: '',
    messageType: 'success',

    fieldDefinitions: [
      { key: 'n', label: 'N', name: 'Number of payments', help: 'Total payment or compounding periods', placeholder: '360', prefix: '', suffix: '' },
      { key: 'rate', label: 'I%', name: 'Annual interest rate', help: 'Nominal annual rate, before compounding', placeholder: '6.5', prefix: '', suffix: '%' },
      { key: 'pv', label: 'PV', name: 'Present value', help: 'Cash flow at the beginning', placeholder: '250000', prefix: '$', suffix: '' },
      { key: 'pmt', label: 'PMT', name: 'Periodic payment', help: 'Equal payment each period', placeholder: '-1580.17', prefix: '$', suffix: '' },
      { key: 'fv', label: 'FV', name: 'Future value', help: 'Cash flow at the end', placeholder: '0', prefix: '$', suffix: '' }
    ],

    get completedCount() {
      return Object.values(this.values).filter(value => value !== '' && value !== null).length;
    },

    calculateMissing() {
      const missing = Object.keys(this.values).filter(key => this.values[key] === '' || this.values[key] === null);
      if (missing.length !== 1) {
        this.setMessage(missing.length === 0 ? 'Clear the value you want to calculate.' : 'Enter four values and leave exactly one empty.', 'error');
        return;
      }
      this.solve(missing[0]);
    },

    solve(target) {
      const needed = Object.keys(this.values).filter(key => key !== target);
      if (needed.some(key => this.values[key] === '' || this.values[key] === null)) {
        this.setMessage(`Enter the other four values before solving ${this.labelFor(target)}.`, 'error');
        return;
      }
      if (!Number.isInteger(Number(this.paymentsPerYear)) || this.paymentsPerYear < 1 || this.paymentsPerYear > 999) {
        this.setMessage('Payments per year must be a whole number from 1 to 999.', 'error');
        return;
      }

      try {
        const answer = this.solveVariable(target);
        if (!Number.isFinite(answer)) throw new Error('No finite solution');
        this.values[target] = this.cleanNumber(answer);
        this.result = {
          key: target,
          label: this.nameFor(target),
          value: answer,
          description: this.describeResult(target, answer)
        };
        this.setMessage(`${this.labelFor(target)} calculated from the other four cash-flow values.`, 'success');
      } catch (_) {
        this.result = null;
        this.setMessage('These cash flows do not produce a usable solution. Check their signs and values.', 'error');
      }
    },

    solveVariable(target) {
      const data = {};
      Object.entries(this.values).forEach(([key, value]) => { data[key] = key === target ? null : Number(value); });
      if (Object.entries(data).some(([key, value]) => key !== target && !Number.isFinite(value))) throw new Error('Invalid value');

      const periods = Number(this.paymentsPerYear);
      if (target === 'rate') return this.solveInterest(data, periods);

      const rate = data.rate / (100 * periods);
      if (rate <= -1) throw new Error('Invalid interest rate');
      const timingFactor = this.timing === 'BEG' ? 1 + rate : 1;

      if (Math.abs(rate) < 1e-14) {
        if (target === 'n') {
          if (data.pmt === 0) throw new Error('No solution');
          return -(data.pv + data.fv) / data.pmt;
        }
        if (target === 'pv') return -(data.pmt * data.n + data.fv);
        if (target === 'pmt') {
          if (data.n === 0) throw new Error('No solution');
          return -(data.pv + data.fv) / data.n;
        }
        if (target === 'fv') return -(data.pv + data.pmt * data.n);
      }

      const growth = (1 + rate) ** data.n;
      const annuity = timingFactor * (growth - 1) / rate;
      if (target === 'pv') return -(data.fv + data.pmt * annuity) / growth;
      if (target === 'pmt') {
        if (annuity === 0) throw new Error('No solution');
        return -(data.pv * growth + data.fv) / annuity;
      }
      if (target === 'fv') return -(data.pv * growth + data.pmt * annuity);
      if (target === 'n') {
        const adjustedPayment = data.pmt * timingFactor / rate;
        const ratio = (adjustedPayment - data.fv) / (data.pv + adjustedPayment);
        if (ratio <= 0 || ratio === 1) throw new Error('No solution');
        return Math.log(ratio) / Math.log(1 + rate);
      }
      throw new Error('No solution');
    },

    solveInterest(data, periods) {
      const equation = rate => {
        if (rate <= -1) return Number.NaN;
        if (Math.abs(rate) < 1e-12) return data.pv + data.pmt * data.n + data.fv;
        const growth = (1 + rate) ** data.n;
        const timingFactor = this.timing === 'BEG' ? 1 + rate : 1;
        return data.pv * growth + data.pmt * timingFactor * (growth - 1) / rate + data.fv;
      };

      let rate = 0.1 / periods;
      for (let iteration = 0; iteration < 80; iteration += 1) {
        const value = equation(rate);
        if (Math.abs(value) < 1e-9) return rate * periods * 100;
        const step = Math.max(1e-7, Math.abs(rate) * 1e-5);
        const derivative = (equation(rate + step) - equation(rate - step)) / (2 * step);
        if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-14) break;
        const next = rate - value / derivative;
        if (!Number.isFinite(next) || next <= -0.999999 || next > 100) break;
        if (Math.abs(next - rate) < 1e-13) return next * periods * 100;
        rate = next;
      }

      let previousRate = -0.9999;
      let previousValue = equation(previousRate);
      for (let index = 1; index <= 20000; index += 1) {
        const candidate = -0.9999 + index * (10.9999 / 20000);
        const value = equation(candidate);
        if (Number.isFinite(previousValue) && Number.isFinite(value) && previousValue * value <= 0) {
          let low = previousRate;
          let high = candidate;
          for (let pass = 0; pass < 100; pass += 1) {
            const middle = (low + high) / 2;
            if (equation(low) * equation(middle) <= 0) high = middle;
            else low = middle;
          }
          return ((low + high) / 2) * periods * 100;
        }
        previousRate = candidate;
        previousValue = value;
      }
      throw new Error('No interest solution');
    },

    loadExample(name) {
      const examples = {
        car: { paymentsPerYear: 12, timing: 'END', values: { n: 36, rate: 10.5, pv: 5750, pmt: '', fv: 0 }, target: 'pmt' },
        mortgage: { paymentsPerYear: 12, timing: 'END', values: { n: 360, rate: 11.5, pv: '', pmt: -630, fv: 0 }, target: 'pv' },
        savings: { paymentsPerYear: 1, timing: 'END', values: { n: '', rate: 7.2, pv: -2000, pmt: 0, fv: 3000 }, target: 'n' }
      };
      const example = examples[name];
      this.paymentsPerYear = example.paymentsPerYear;
      this.timing = example.timing;
      this.values = { ...example.values };
      this.result = null;
      this.message = '';
      this.$nextTick(() => this.solve(example.target));
    },

    reset() {
      this.paymentsPerYear = 12;
      this.timing = 'END';
      this.values = { n: '', rate: '', pv: '', pmt: '', fv: '' };
      this.result = null;
      this.message = '';
    },

    markChanged() {
      this.result = null;
      this.message = '';
    },

    setMessage(message, type) {
      this.message = message;
      this.messageType = type;
    },

    labelFor(key) {
      return { n: 'N', rate: 'I%YR', pv: 'PV', pmt: 'PMT', fv: 'FV' }[key];
    },

    nameFor(key) {
      return this.fieldDefinitions.find(field => field.key === key).name;
    },

    cleanNumber(value) {
      return Number.parseFloat(Number(value).toPrecision(12));
    },

    formatResult(key, value) {
      if (['pv', 'pmt', 'fv'].includes(key)) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
      }
      if (key === 'rate') return `${this.formatNumber(value, 6)}%`;
      return `${this.formatNumber(value, 6)} periods`;
    },

    formatNumber(value, digits = 2) {
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(Number(value));
    },

    displayCashFlow(key) {
      const value = Number(this.values[key]);
      if (this.values[key] === '' || !Number.isFinite(value)) return '—';
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: Math.abs(value) >= 1000000 ? 'compact' : 'standard', maximumFractionDigits: 0 }).format(value);
    },

    describeResult(key, value) {
      if (key === 'n') return `The cash flows reach the target after ${this.formatNumber(value, 4)} payment periods.`;
      if (key === 'rate') return `This is the nominal annual rate, compounded ${this.paymentsPerYear} times per year.`;
      if (key === 'pv') return value >= 0 ? 'This is the amount received at the beginning of the transaction.' : 'This is the amount paid or invested at the beginning.';
      if (key === 'pmt') return value >= 0 ? 'This amount is received each payment period.' : 'This amount is paid each payment period.';
      return value >= 0 ? 'This is the amount received at the end of the final period.' : 'This is the amount paid at the end of the final period.';
    }
  }));
});
