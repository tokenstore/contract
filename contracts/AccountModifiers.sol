pragma solidity ^0.4.11;

contract Ownable {
  address public owner;

  function Ownable() {
    owner = msg.sender;
  }

  modifier onlyOwner() {
    require(msg.sender == owner);
    _;
  }

  function transferOwnership(address newOwner) onlyOwner {
    if (newOwner != address(0)) {
      owner = newOwner;
    }
  }
}

contract AccountModifiers is Ownable {

  // 0 - taker fee, in % (Eg: 3000000000000000)
  // 1 - rebate, in % of taker fee (Eg: 1000000000000000000 for 100%)
  mapping (address => uint[2]) public accountModifiers;

  function setModifiers(address user, uint takeFee, uint rebate) onlyOwner {
    accountModifiers[user] = [takeFee, rebate];
  }

  function modifiers(address user) constant returns(uint takeFee, uint rebate) {
    return (accountModifiers[user][0], accountModifiers[user][1]);
  }
}
