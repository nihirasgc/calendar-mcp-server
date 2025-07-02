import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema({
  content: { type: String, required: true },
  listId: { type: mongoose.Schema.Types.ObjectId, ref: 'List', required: true },
});

const Item = mongoose.model('Item', itemSchema);
export default Item;
