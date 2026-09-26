document.addEventListener('alpine:init', () => {
  Alpine.data('calculator', () => ({
    powered: true,
    display: '0',
    entry: '',
    tokens: [],
    expressionLine: 'READY',
    memory: null,
    shift: false,
    angleMode: 'DEG',
    justEvaluated: false,
    history: [],
    historyIndex: 0,
    appMode: 'calculator',
    tvm: {
      n: null,
      rate: null,
      pv: null,
      pmt: null,
      fv: null,
      paymentsPerYear: 12,
      timing: 'END'
    },
    amort: {
      nextPayment: 1,
      count: null,
      interest: null,
      principal: null,
      balance: null,
      first: null,
      last: null
    },

    init() {
      const saved = Number.parseFloat(localStorage.getItem('hp27s-memory'));
      if (Number.isFinite(saved)) this.memory = saved;
      try {
        const savedTvm = JSON.parse(localStorage.getItem('hp27s-tvm'));
        if (savedTvm && typeof savedTvm === 'object') this.tvm = { ...this.tvm, ...savedTvm };
      } catch (_) {
        // Ignore malformed local state and retain the manual's defaults.
      }
    },

    wake() {
      if (!this.powered) {
        this.powered = true;
        this.display = '0';
        this.expressionLine = 'READY';
        return false;
      }
      return true;
    },

    digit(value) {
      if (!this.wake()) return;
      if (this.shift && value === '9' && this.appMode === 'calculator') {
        this.enterTvm();
        return;
      }
      if (this.justEvaluated) this.resetExpression();
      if (this.entry === '0') this.entry = '';
      if (this.entry.replace('-', '').replace('.', '').length >= 12) return;
      this.entry += value;
      this.display = this.entry;
      this.expressionLine = this.expressionPreview();
    },

    decimal() {
      if (!this.wake()) return;
      if (this.justEvaluated) this.resetExpression();
      if (!this.entry.includes('.')) this.entry = this.entry ? `${this.entry}.` : '0.';
      this.display = this.entry;
      this.expressionLine = this.expressionPreview();
    },

    operator(op) {
      if (!this.wake()) return;
      if (this.display === 'Error') this.clearAll();
      if (this.justEvaluated) {
        this.tokens = [Number(this.display)];
        this.justEvaluated = false;
      } else {
        this.commitEntry();
      }
      const last = this.tokens[this.tokens.length - 1];
      if (this.isOperator(last)) this.tokens[this.tokens.length - 1] = op;
      else if (typeof last === 'number' || last === ')') this.tokens.push(op);
      else return;
      this.expressionLine = this.expressionPreview();
      this.entry = '';
    },

    parenthesis(mark) {
      if (!this.wake()) return;
      if (this.justEvaluated) this.resetExpression();
      if (mark === '(') {
        if (this.entry) {
          this.commitEntry();
          this.tokens.push('*');
        } else if (typeof this.tokens[this.tokens.length - 1] === 'number' || this.tokens[this.tokens.length - 1] === ')') {
          this.tokens.push('*');
        }
        this.tokens.push('(');
      } else {
        this.commitEntry();
        const opens = this.tokens.filter(t => t === '(').length;
        const closes = this.tokens.filter(t => t === ')').length;
        if (opens > closes && (typeof this.tokens[this.tokens.length - 1] === 'number' || this.tokens[this.tokens.length - 1] === ')')) this.tokens.push(')');
      }
      this.expressionLine = this.expressionPreview();
    },

    equals() {
      if (!this.wake()) return;
      this.commitEntry();
      while (this.isOperator(this.tokens[this.tokens.length - 1])) this.tokens.pop();
      if (!this.tokens.length) return;
      const opens = this.tokens.filter(t => t === '(').length;
      const closes = this.tokens.filter(t => t === ')').length;
      for (let i = closes; i < opens; i++) this.tokens.push(')');
      const expression = this.tokens.map(t => this.prettyToken(t)).join(' ');
      try {
        const result = this.evaluate(this.tokens);
        if (!Number.isFinite(result)) throw new Error('Math error');
        this.display = this.format(result);
        this.entry = String(result);
        this.expressionLine = `${expression} =`;
        this.history.push({ expression: this.expressionLine, value: result });
        this.history = this.history.slice(-20);
        this.historyIndex = this.history.length;
        this.tokens = [];
        this.justEvaluated = true;
      } catch (_) {
        this.showError();
      }
    },

    evaluate(tokens) {
      const output = [];
      const operators = [];
      const precedence = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
      const rightAssociative = op => op === '^';
      tokens.forEach(token => {
        if (typeof token === 'number') output.push(token);
        else if (this.isOperator(token)) {
          while (operators.length && this.isOperator(operators.at(-1)) &&
            (precedence[operators.at(-1)] > precedence[token] ||
            (precedence[operators.at(-1)] === precedence[token] && !rightAssociative(token)))) {
            output.push(operators.pop());
          }
          operators.push(token);
        } else if (token === '(') operators.push(token);
        else if (token === ')') {
          while (operators.length && operators.at(-1) !== '(') output.push(operators.pop());
          if (operators.pop() !== '(') throw new Error('Parenthesis mismatch');
        }
      });
      while (operators.length) {
        const op = operators.pop();
        if (op === '(') throw new Error('Parenthesis mismatch');
        output.push(op);
      }
      const stack = [];
      output.forEach(token => {
        if (typeof token === 'number') stack.push(token);
        else {
          const b = stack.pop();
          const a = stack.pop();
          if (a === undefined || b === undefined) throw new Error('Invalid expression');
          if (token === '+') stack.push(a + b);
          if (token === '-') stack.push(a - b);
          if (token === '*') stack.push(a * b);
          if (token === '/') stack.push(a / b);
          if (token === '^') stack.push(a ** b);
        }
      });
      if (stack.length !== 1) throw new Error('Invalid expression');
      return stack[0];
    },

    applyFunction(name) {
      if (!this.wake()) return;
      const x = this.currentValue();
      let value;
      let label;
      if (name === 'sqrt') { value = Math.sqrt(x); label = '√'; }
      if (name === 'square') { value = x ** 2; label = 'SQR'; }
      if (name === 'exp') { value = Math.exp(x); label = 'EXP'; }
      if (name === 'ln') { value = Math.log(x); label = 'LN'; }
      if (name === 'reciprocal') { value = 1 / x; label = '1/'; }
      if (!Number.isFinite(value)) return this.showError();
      this.setFunctionResult(value, `${label}(${this.format(x)})`);
    },

    trig(name) {
      if (!this.wake()) return;
      const x = this.currentValue();
      const inverse = this.shift;
      let value;
      if (inverse) {
        value = Math[name === 'sin' ? 'asin' : name === 'cos' ? 'acos' : 'atan'](x);
        if (this.angleMode === 'DEG') value = value * 180 / Math.PI;
      } else {
        const radians = this.angleMode === 'DEG' ? x * Math.PI / 180 : x;
        value = Math[name](radians);
      }
      this.shift = false;
      if (!Number.isFinite(value)) return this.showError();
      this.setFunctionResult(value, `${inverse ? 'A' : ''}${name.toUpperCase()}(${this.format(x)})`);
    },

    setFunctionResult(value, label) {
      this.display = this.format(value);
      this.entry = String(value);
      this.tokens = [];
      this.expressionLine = label;
      this.justEvaluated = true;
    },

    currentValue() {
      const value = Number.parseFloat(this.entry || this.display);
      return Number.isFinite(value) ? value : 0;
    },

    percent() {
      if (!this.wake()) return;
      const value = this.currentValue() / 100;
      this.entry = String(value);
      this.display = this.format(value);
      this.expressionLine = `${this.format(value * 100)}%`;
    },

    constantPi() {
      if (!this.wake()) return;
      if (this.justEvaluated) this.resetExpression();
      this.entry = String(Math.PI);
      this.display = this.format(Math.PI);
      this.expressionLine = this.expressionPreview();
    },

    toggleSign() {
      if (!this.wake()) return;
      const value = -this.currentValue();
      this.entry = String(value);
      this.display = this.format(value);
      this.justEvaluated = false;
    },

    backspace() {
      if (!this.wake()) return;
      if (this.justEvaluated || this.display === 'Error') return this.clearAll();
      this.entry = this.entry.slice(0, -1);
      this.display = this.entry || '0';
      this.expressionLine = this.expressionPreview();
    },

    memoryStore() {
      if (!this.wake()) return;
      this.memory = this.currentValue();
      localStorage.setItem('hp27s-memory', String(this.memory));
      this.expressionLine = 'STO → MEMORY';
    },

    storageKey(action) {
      if (!this.shift) return action === 'store' ? this.memoryStore() : this.memoryRecall();
      const x = this.currentValue();
      const value = action === 'store' ? 10 ** x : Math.log10(x);
      this.shift = false;
      if (!Number.isFinite(value)) return this.showError();
      this.setFunctionResult(value, `${action === 'store' ? '10^' : 'LOG('}${this.format(x)}${action === 'store' ? '' : ')'}`);
    },

    memoryRecall() {
      if (!this.wake() || this.memory === null) return;
      if (this.justEvaluated) this.resetExpression();
      this.entry = String(this.memory);
      this.display = this.format(this.memory);
      this.expressionLine = 'RCL MEMORY';
    },

    enterTvm() {
      this.appMode = 'tvm';
      this.shift = false;
      this.entry = '';
      this.tokens = [];
      this.justEvaluated = false;
      this.display = 'TVM';
      this.expressionLine = this.tvmStatus();
    },

    tvmMenuLabels() {
      if (this.appMode === 'tvm') return ['N', 'I%YR', 'PV', 'PMT', 'FV', 'OTHER'];
      if (this.appMode === 'tvm-other') return ['P/YR', 'BEG', 'END', 'AMRT', '', ''];
      if (this.appMode === 'amort') return ['#P', 'INT', 'PRIN', 'BAL', 'NEXT', 'TABLE'];
      return [];
    },

    tvmLabel(field) {
      return { n: 'N', rate: 'I%YR', pv: 'PV', pmt: 'PMT', fv: 'FV' }[field];
    },

    tvmStatus() {
      return `${this.tvm.paymentsPerYear} P/YR  ${this.tvm.timing} MODE`;
    },

    tvmSoftKey(index) {
      if (this.appMode === 'tvm') {
        const fields = ['n', 'rate', 'pv', 'pmt', 'fv'];
        if (index < fields.length) this.tvmStoreOrSolve(fields[index]);
        else {
          this.appMode = 'tvm-other';
          this.entry = '';
          this.tokens = [];
          this.display = 'OTHER';
          this.expressionLine = this.tvmStatus();
        }
        return;
      }

      if (this.appMode === 'tvm-other') {
        if (index === 0) this.setPaymentsPerYear();
        if (index === 1) this.setTvmTiming('BEG');
        if (index === 2) this.setTvmTiming('END');
        if (index === 3) this.enterAmortization();
        return;
      }

      if (this.appMode === 'amort') this.amortSoftKey(index);
    },

    tvmStoreOrSolve(field) {
      const hasInput = this.entry !== '' || this.tokens.length > 0;
      if (hasInput) {
        try {
          const value = this.resolveInputValue();
          this.tvm[field] = value;
          this.saveTvm();
          this.showTvmValue(field, value, false);
        } catch (_) {
          this.showTvmError('INVALID INPUT');
        }
        return;
      }

      try {
        const value = this.solveTvm(field);
        this.tvm[field] = value;
        this.saveTvm();
        this.showTvmValue(field, value, true);
      } catch (error) {
        this.showTvmError(error.message || 'NO SOLUTION');
      }
    },

    resolveInputValue() {
      if (!this.tokens.length) {
        const value = Number(this.entry || this.display);
        if (!Number.isFinite(value)) throw new Error('Invalid input');
        this.entry = '';
        return value;
      }
      this.commitEntry();
      while (this.isOperator(this.tokens[this.tokens.length - 1])) this.tokens.pop();
      const value = this.evaluate(this.tokens);
      this.tokens = [];
      this.entry = '';
      if (!Number.isFinite(value)) throw new Error('Invalid input');
      return value;
    },

    solveTvm(field) {
      const required = ['n', 'rate', 'pv', 'pmt', 'fv'].filter(name => name !== field);
      if (required.some(name => !Number.isFinite(this.tvm[name]))) throw new Error('KEY IN 4 VALUES');

      const n = this.tvm.n;
      const pv = this.tvm.pv;
      const pmt = this.tvm.pmt;
      const fv = this.tvm.fv;
      const beginFactor = rate => this.tvm.timing === 'BEG' ? 1 + rate : 1;

      if (field === 'rate') return this.solveTvmInterest();

      const rate = this.tvm.rate / (100 * this.tvm.paymentsPerYear);
      if (rate <= -1) throw new Error('NO SOLUTION');
      if (Math.abs(rate) < 1e-14) {
        if (field === 'n') {
          if (pmt === 0) throw new Error('NO SOLUTION');
          return -(pv + fv) / pmt;
        }
        if (field === 'pv') return -(pmt * n + fv);
        if (field === 'pmt') {
          if (n === 0) throw new Error('NO SOLUTION');
          return -(pv + fv) / n;
        }
        if (field === 'fv') return -(pv + pmt * n);
      }

      const growth = (1 + rate) ** n;
      const annuity = beginFactor(rate) * (growth - 1) / rate;
      if (field === 'pv') return -(fv + pmt * annuity) / growth;
      if (field === 'pmt') {
        if (annuity === 0) throw new Error('NO SOLUTION');
        return -(pv * growth + fv) / annuity;
      }
      if (field === 'fv') return -(pv * growth + pmt * annuity);
      if (field === 'n') {
        const adjustedPayment = pmt * beginFactor(rate) / rate;
        const ratio = (adjustedPayment - fv) / (pv + adjustedPayment);
        if (ratio <= 0 || ratio === 1) throw new Error('NO SOLUTION');
        return Math.log(ratio) / Math.log(1 + rate);
      }
      throw new Error('NO SOLUTION');
    },

    solveTvmInterest() {
      const { n, pv, pmt, fv, paymentsPerYear } = this.tvm;
      const equation = rate => {
        if (rate <= -1) return Number.NaN;
        if (Math.abs(rate) < 1e-12) return pv + pmt * n + fv;
        const growth = (1 + rate) ** n;
        const timing = this.tvm.timing === 'BEG' ? 1 + rate : 1;
        return pv * growth + pmt * timing * (growth - 1) / rate + fv;
      };

      let rate = Math.max(-0.9, (this.tvm.rate || 10) / (100 * paymentsPerYear));
      for (let iteration = 0; iteration < 80; iteration += 1) {
        const value = equation(rate);
        if (Math.abs(value) < 1e-9) return rate * paymentsPerYear * 100;
        const step = Math.max(1e-7, Math.abs(rate) * 1e-5);
        const derivative = (equation(rate + step) - equation(rate - step)) / (2 * step);
        if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-14) break;
        const next = rate - value / derivative;
        if (!Number.isFinite(next) || next <= -0.999999 || next > 100) break;
        if (Math.abs(next - rate) < 1e-13) return next * paymentsPerYear * 100;
        rate = next;
      }

      let previousRate = -0.9999;
      let previousValue = equation(previousRate);
      for (let index = 1; index <= 20000; index += 1) {
        const candidate = -0.9999 + index * (10.9999 / 20000);
        const candidateValue = equation(candidate);
        if (Number.isFinite(previousValue) && Number.isFinite(candidateValue) && previousValue * candidateValue <= 0) {
          let low = previousRate;
          let high = candidate;
          for (let pass = 0; pass < 100; pass += 1) {
            const middle = (low + high) / 2;
            if (equation(low) * equation(middle) <= 0) high = middle;
            else low = middle;
          }
          return ((low + high) / 2) * paymentsPerYear * 100;
        }
        previousRate = candidate;
        previousValue = candidateValue;
      }
      throw new Error('NO SOLUTION');
    },

    setPaymentsPerYear() {
      if (this.entry !== '' || this.tokens.length) {
        try {
          const value = this.resolveInputValue();
          if (!Number.isInteger(value) || value < 1 || value > 999) throw new Error('Range');
          this.tvm.paymentsPerYear = value;
          this.saveTvm();
        } catch (_) {
          return this.showTvmError('P/YR 1 THROUGH 999');
        }
      }
      this.display = `${this.tvm.paymentsPerYear} P/YR`;
      this.expressionLine = this.tvmStatus();
    },

    setTvmTiming(timing) {
      this.tvm.timing = timing;
      this.entry = '';
      this.tokens = [];
      this.display = `${timing} MODE`;
      this.expressionLine = this.tvmStatus();
      this.saveTvm();
    },

    showTvmValue(field, value, calculated) {
      this.entry = '';
      this.tokens = [];
      this.justEvaluated = false;
      this.expressionLine = calculated ? 'CALCULATED' : this.tvmStatus();
      this.display = `${this.tvmLabel(field)}=${this.formatTvm(value)}`;
    },

    showTvmError(message) {
      this.entry = '';
      this.tokens = [];
      this.justEvaluated = false;
      this.expressionLine = 'TVM ERROR';
      this.display = message;
    },

    formatTvm(value) {
      if (!Number.isFinite(Number(value))) return '—';
      const number = Number(value);
      if (Math.abs(number) >= 1e10 || (number !== 0 && Math.abs(number) < 1e-7)) return number.toExponential(6).replace('+', '');
      return number.toLocaleString('en-US', { maximumFractionDigits: 8, useGrouping: false });
    },

    saveTvm() {
      localStorage.setItem('hp27s-tvm', JSON.stringify(this.tvm));
    },

    enterAmortization() {
      if (![this.tvm.rate, this.tvm.pv, this.tvm.pmt].every(Number.isFinite)) {
        return this.showTvmError('KEY I%YR, PV, PMT');
      }
      this.appMode = 'amort';
      this.resetAmortization();
      this.display = 'KEY #PMTS';
      this.expressionLine = 'PRESS #P';
    },

    resetAmortization() {
      this.amort = {
        nextPayment: 1,
        count: null,
        interest: null,
        principal: null,
        balance: this.tvm.pv,
        first: null,
        last: null
      };
      this.entry = '';
      this.tokens = [];
    },

    amortSoftKey(index) {
      if (index === 0) {
        if (this.entry === '' && !this.tokens.length) {
          this.display = 'KEY #PMTS';
          this.expressionLine = 'PRESS #P';
          return;
        }
        try {
          const count = this.resolveInputValue();
          if (!Number.isInteger(count) || count < 1 || count > 1200) throw new Error('Range');
          this.calculateAmortization(count);
        } catch (_) {
          this.showTvmError('#P 1 THROUGH 1200');
        }
        return;
      }
      if (index === 1) this.showAmortValue('INTEREST', this.amort.interest);
      if (index === 2) this.showAmortValue('PRINCIPAL', this.amort.principal);
      if (index === 3) this.showAmortValue('BALANCE', this.amort.balance);
      if (index === 4) {
        if (!this.amort.count) return this.showTvmError('KEY #PMTS FIRST');
        this.calculateAmortization(this.amort.count);
      }
      if (index === 5) {
        this.display = 'NO PRINTER';
        this.expressionLine = 'TABLE UNAVAILABLE';
      }
    },

    calculateAmortization(count) {
      const rate = this.tvm.rate / (100 * this.tvm.paymentsPerYear);
      let balance = this.amort.balance;
      let interest = 0;
      let principal = 0;
      const first = this.amort.nextPayment;

      for (let payment = 0; payment < count; payment += 1) {
        const paymentNumber = first + payment;
        const interestCharge = this.tvm.timing === 'BEG' && paymentNumber === 1 ? 0 : balance * rate;
        if (this.tvm.timing === 'BEG') balance += interestCharge;
        const interestPart = -interestCharge;
        const principalPart = this.tvm.pmt - interestPart;
        interest += interestPart;
        principal += principalPart;
        if (this.tvm.timing === 'END') balance += principalPart;
        else balance += this.tvm.pmt;
      }

      this.amort.count = count;
      this.amort.interest = interest;
      this.amort.principal = principal;
      this.amort.balance = balance;
      this.amort.first = first;
      this.amort.last = first + count - 1;
      this.amort.nextPayment = this.amort.last + 1;
      this.display = `#P=${count} PMTS`;
      this.expressionLine = `${this.amort.first}–${this.amort.last}`;
    },

    showAmortValue(label, value) {
      if (!Number.isFinite(value)) return this.showTvmError('KEY #PMTS FIRST');
      this.expressionLine = `${this.amort.first}–${this.amort.last}`;
      this.display = `${label}=${this.formatTvm(value)}`;
    },

    toggleShift() {
      if (!this.wake()) return;
      this.shift = !this.shift;
      this.expressionLine = this.shift ? 'BLUE FUNCTIONS' : this.expressionPreview();
    },

    toggleAngle() {
      this.angleMode = this.angleMode === 'DEG' ? 'RAD' : 'DEG';
    },

    exitKey() {
      this.shift = false;
      this.entry = '';
      this.tokens = [];
      this.justEvaluated = false;
      if (this.appMode === 'amort') {
        this.appMode = 'tvm-other';
        this.display = 'OTHER';
        this.expressionLine = this.tvmStatus();
      } else if (this.appMode === 'tvm-other') {
        this.appMode = 'tvm';
        this.display = 'TVM';
        this.expressionLine = this.tvmStatus();
      } else if (this.appMode === 'tvm') {
        this.appMode = 'calculator';
        this.display = '0';
        this.expressionLine = 'READY';
      }
    },

    inputKey() {
      if (this.shift && this.appMode !== 'calculator') {
        this.shift = false;
        if (this.appMode === 'amort') {
          this.resetAmortization();
          this.display = 'KEY #PMTS';
          this.expressionLine = 'SCHEDULE RESET';
          return;
        }
        if (this.appMode === 'tvm-other') {
          this.tvm.paymentsPerYear = 12;
          this.tvm.timing = 'END';
        } else {
          ['n', 'rate', 'pv', 'pmt', 'fv'].forEach(field => { this.tvm[field] = null; });
        }
        this.saveTvm();
        this.entry = '';
        this.tokens = [];
        this.display = '0';
        this.expressionLine = this.tvmStatus();
        return;
      }
      this.clearAll();
    },

    clearOrPower() {
      if (!this.powered) return this.wake();
      if (this.shift) {
        this.powered = false;
        this.shift = false;
      } else this.clearAll();
    },

    clearAll() {
      this.powered = true;
      this.display = '0';
      this.entry = '';
      this.tokens = [];
      this.expressionLine = this.appMode === 'calculator' ? 'READY' : this.tvmStatus();
      this.shift = false;
      this.justEvaluated = false;
    },

    resetExpression() {
      this.entry = '';
      this.tokens = [];
      this.justEvaluated = false;
      this.expressionLine = '';
    },

    commitEntry() {
      if (!this.entry) return;
      const number = Number(this.entry);
      if (!Number.isFinite(number)) throw new Error('Invalid number');
      this.tokens.push(number);
      this.entry = '';
    },

    expressionPreview() {
      const items = this.tokens.map(t => this.prettyToken(t));
      if (this.entry) items.push(this.entry);
      return items.join(' ') || 'READY';
    },

    prettyToken(token) {
      if (token === '*') return '×';
      if (token === '/') return '÷';
      if (token === '-') return '−';
      return typeof token === 'number' ? this.format(token) : token;
    },

    isOperator(value) { return ['+', '-', '*', '/', '^'].includes(value); },

    format(value) {
      if (!Number.isFinite(Number(value))) return 'Error';
      const number = Number(value);
      if (number === 0) return '0';
      const absolute = Math.abs(number);
      if (absolute >= 1e11 || absolute < 1e-9) return number.toExponential(8).replace('+', '');
      return Number.parseFloat(number.toPrecision(11)).toString();
    },

    showError() {
      this.display = 'Error';
      this.expressionLine = 'INVALID OPERATION';
      this.entry = '';
      this.tokens = [];
      this.justEvaluated = true;
    },

    browseHistory(direction) {
      if (!this.history.length) return;
      this.historyIndex = Math.max(0, Math.min(this.history.length - 1, this.historyIndex + direction));
      const item = this.history[this.historyIndex];
      this.expressionLine = item.expression;
      this.display = this.format(item.value);
      this.entry = String(item.value);
      this.tokens = [];
      this.justEvaluated = true;
    },

    handleKeyboard(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (/^[0-9]$/.test(key)) this.digit(key);
      else if (key === '.') this.decimal();
      else if (['+', '-', '*', '/', '^'].includes(key)) this.operator(key);
      else if (key === '(' || key === ')') this.parenthesis(key);
      else if (key === 'Enter' || key === '=') this.equals();
      else if (key === 'Backspace') this.backspace();
      else if (key === 'Escape') this.appMode === 'calculator' ? this.clearAll() : this.exitKey();
      else if (key.toLowerCase() === 'p') this.constantPi();
      else return;
      event.preventDefault();
    }
  }));
});
