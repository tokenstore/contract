pragma solidity ^0.4.13;

// Interface for trade tacker

contract TradeTrackerInterface {
  function tradeComplete(address _tokenGet, uint _amountGet, address _tokenGive, uint _amountGive, address _get, address _give, uint _takerFee, uint _makerRebate);
}