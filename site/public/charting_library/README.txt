Put the TradingView Advanced Charts package here:
  public/charting_library/charting_library.standalone.js  (+ the rest of the package: bundles/, ...)
  public/datafeeds/udf/dist/bundle.js
Licence (free, application required): https://www.tradingview.com/advanced-charts/
The site detects the file at runtime and switches the token page chart to the TradingView widget,
fed by the ArcTools UDF datafeed: https://bot-production-4200.up.railway.app/udf/{config,symbols,history,search,time}
