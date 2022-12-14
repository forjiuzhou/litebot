import ccxt from 'ccxt';
import moment from 'moment';
import { Exchange, Order } from 'ccxt';
import { Notifier } from '../notifier';

export
class SpotReal {
  public constructor(private readonly config: {
    name: string,
    exchange: Exchange,
    symbol: string,
    funds: number,
    assets?: number,
    notifier?: Notifier,
  }) {
    this.funds = this.config.funds;
    this.assets = this.config.assets || 0;
    this.funds_name = this.config.symbol.split('/')[1];
    this.assets_name = this.config.symbol.split('/')[0];
  }

  private funds = 0;
  private assets = 0;
  private funds_name = '';
  private assets_name = '';

  private build_transaction_message(order: Order, price: number, in_out: [number, number], order_time: string) {
    const message = {
      name: this.config.name,
      time: moment(new Date(order.timestamp)).format('YYYY-MM-DD HH:mm:ss'),
      symbol: order.symbol, side: order.side,
      in_amount: in_out[0], out_amount: in_out[1],
      expected_price: price, final_price: order.price, deviation: `${(order.price - price) / price * 100}%`,
      funds: this.funds, assets: this.assets,
      order_time,
    };
    console.log(message);
    return JSON.stringify(message, null, 2);
  }

  private build_error_message(error: any, side?: string) {
    const message = {
      name: this.config.name,
      time: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
      symbol: this.config.symbol, side,
      message: error?.toString() || 'an error occurred, please check the log',
    };
    console.log(message);
    return JSON.stringify(message, null, 2);
  }

  private send_message(message: string) {
    this.config.notifier?.SendMessage(message);
  }

  private async get_balance(currency: string) {
    return (await this.config.exchange.fetchFreeBalance())[currency];
  }

  public async BuyAll(price: number, sync = false) {
    try {
      const request_time = Number(new Date());
      const real_funds = sync ? await this.get_balance(this.funds_name) : this.funds;
      this.funds = this.funds > real_funds ? real_funds : this.funds;
      const order = await this.config.exchange.createMarketOrder(
        this.config.symbol,
        'buy',
        0,
        undefined,
        {
          quoteOrderQty: this.config.exchange.costToPrecision(this.config.symbol, this.funds),
        },
      );
      const order_time = `${(Number(new Date()) - request_time) / 1000}s`;
      const in_amount = order.cost;
      const out_amount = order.amount - (this.config.symbol.startsWith(order.fee?.currency) ? order.fee.cost : 0);
      this.funds -= in_amount;
      this.assets += out_amount;
      this.final_price = order.price;
      this.send_message(this.build_transaction_message(order, price, [in_amount, out_amount], order_time));
    } catch (e) {
      if (!sync && e instanceof ccxt.ExchangeError) this.BuyAll(price, true);
      console.log(e);
      this.send_message(this.build_error_message(e, 'buy'));
    }
  }

  public async SellAll(price: number, sync = false) {
    const final_price = this.final_price;
    this.final_price = NaN;
    try {
      const request_time = Number(new Date());
      const real_assets = sync ? await this.get_balance(this.assets_name) : this.assets;
      this.assets = this.assets > real_assets ? real_assets : this.assets;
      const order = await this.config.exchange.createMarketOrder(
        this.config.symbol,
        'sell',
        this.config.exchange.amountToPrecision(this.config.symbol, this.assets),
      );
      const order_time = `${(Number(new Date()) - request_time) / 1000}s`;
      const in_amount = order.amount;
      const out_amount = order.cost - (this.config.symbol.endsWith(order.fee?.currency) ? order.fee.cost : 0);
      this.assets -= in_amount;
      this.funds += out_amount;
      this.send_message(this.build_transaction_message(order, price, [in_amount, out_amount], order_time));
    } catch (e) {
      this.final_price = final_price;
      if (!sync && e instanceof ccxt.ExchangeError) this.SellAll(price, true);
      console.log(e);
      this.send_message(this.build_error_message(e, 'sell'));
    }
  }

  private final_price = NaN;

  public Risk(price: number) {
    return (price - this.final_price) / this.final_price;
  }
}
