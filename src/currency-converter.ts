import https from 'https';

interface ExchangeRates {
  [currency: string]: number;
}

/**
 * Gets exchange rates from the open.er-api.com service
 * This is a free, no-API-key required exchange rate API
 * @throws Error if unable to fetch or parse the exchange rates
 */
export async function getOfficialExchangeRates(): Promise<ExchangeRates> {
  return new Promise((resolve, reject) => {
    const url = 'https://open.er-api.com/v6/latest/CHF';
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          if (response.rates) {
            // Exchange rates are already CHF-based (we requested /latest/CHF)
            const rates: ExchangeRates = { 'CHF': 1 };
            
            // Copy all rates
            Object.keys(response.rates).forEach(currency => {
              rates[currency] = response.rates[currency];
            });
            
            // Invert all rates to get conversion to CHF
            // The API gives rates FROM the base currency, but we want rates TO the base currency
            Object.keys(rates).forEach(currency => {
              if (currency !== 'CHF') {
                rates[currency] = 1 / rates[currency];
              }
            });
            
            resolve(rates);
          } else {
            reject(new Error('Invalid response format from exchange rate API'));
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          reject(new Error(`Failed to parse exchange rates: ${errorMessage}`));
        }
      });
    }).on('error', (error) => {
      reject(new Error(`Failed to fetch exchange rates: ${error.message}`));
    });
  });
}

/**
 * Converts an amount from one currency to another
 * @throws Error if conversion is not possible
 */
export function convertCurrency(
  amount: number, 
  fromCurrency: string, 
  toCurrency: string, 
  rates: ExchangeRates
): number {
  if (fromCurrency === toCurrency) {
    return amount;
  }
  
  if (!rates[fromCurrency] || !rates[toCurrency]) {
    throw new Error(`No conversion rate available for ${fromCurrency} to ${toCurrency}`);
  }
  
  // First convert to CHF, then to target currency
  const amountInCHF = amount * rates[fromCurrency];
  // Since our rates are already inverted to be "to CHF", we divide by the target rate
  return amountInCHF / rates[toCurrency];
} 