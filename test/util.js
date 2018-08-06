import BigNumber from 'bignumber.js'
import ethUtil from 'ethereumjs-util'
import ethAbi from 'ethereumjs-abi'


export function ethToWei(eth, divisorIn) {
  const divisor = !divisorIn ? 1000000000000000000 : divisorIn

  return parseFloat((eth * divisor).toPrecision(10))
}

export function weiToEth(wei, divisorIn) {
  const divisor = !divisorIn ? 1000000000000000000 : divisorIn

  return (wei / divisor).toFixed(3)
}

export function getDivisor(token) {
  let result = 1000000000000000000
  if (token && token.decimals !== undefined) {
    result = Math.pow(10, token.decimals)
  }

  return new BigNumber(result)
}

export function signOrder(web3, exchangeAddress, creatorAddress, tokenGet, amountGet, tokenGive, amountGive, expires, nonce) {
  let values = [exchangeAddress, tokenGet, amountGet, tokenGive, amountGive, expires, nonce];
  let types = ["address", "address", "uint256", "address", "uint256", "uint256", "uint256"];

  const hash = `0x${ethAbi.soliditySHA256(types, values).toString('hex')}`;
  return getSignature(web3, creatorAddress, hash);
}

export function sign0xOrder(web3, exchangeAddress, orderAddresses, orderValues) {

  let values = [exchangeAddress, orderAddresses[0], orderAddresses[1], orderAddresses[2], orderAddresses[3], orderAddresses[4],
    orderValues[0], orderValues[1], orderValues[2], orderValues[3], orderValues[4], orderValues[5]
  ];
  let types = ["address", "address", "address", "address", "address", "address",
    "uint256", "uint256", "uint256", "uint256", "uint256", "uint256"
  ];

  const hash = `0x${ethAbi.soliditySHA3(types, values).toString('hex')}`;
  return getSignature(web3, orderAddresses[0], hash);
}

function getSignature(web3, maker, hash) {
  let sigResult = web3.eth.sign(maker, hash);
  let sig = ethUtil.fromRpcSig(sigResult);
  sig.r = `0x${sig.r.toString('hex')}`;
  sig.s = `0x${sig.s.toString('hex')}`;
  sig.hash = hash;
  return sig;
}
