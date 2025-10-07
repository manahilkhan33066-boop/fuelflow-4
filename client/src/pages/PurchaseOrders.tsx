import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { PurchaseOrder, Supplier, Product, Tank } from "@shared/schema";
import { insertPurchaseOrderSchema } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/contexts/CurrencyContext";
import { apiRequest } from "@/lib/api";
import { Plus, Eye, Edit, Trash2, FileText, Calendar, Search, Filter } from "lucide-react";
import { printReport } from "@/lib/printUtils";
import { format, subDays, addDays } from "date-fns";
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { StandardPageHeader } from "@/components/ui/standard-page-header";
import { StandardFilterBar } from "@/components/ui/standard-filter-bar";

const purchaseOrderSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  orderDate: z.string().min(1, "Order date is required"),
  notes: z.string().optional(),
  status: z.enum(["pending", "approved", "delivered", "cancelled"]).default("pending"),
});

const purchaseItemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  quantity: z.string().min(1, "Quantity is required"),
  unitPrice: z.string().min(1, "Unit price is required"),
});

export default function PurchaseOrders() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { formatCurrency, currencyConfig } = useCurrency();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [open, setOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [orderItems, setOrderItems] = useState<Array<{productId: string; quantity: string; unitPrice: string}>>([
    { productId: "", quantity: "", unitPrice: "" }
  ]);

  const form = useForm({
    resolver: zodResolver(purchaseOrderSchema),
    defaultValues: {
      supplierId: "",
      orderDate: new Date().toISOString().split('T')[0],
      notes: "",
      status: "pending" as const,
    },
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const createPurchaseOrderMutation = useMutation({
    mutationFn: async (data: any) => {
      const validItems = orderItems.filter(item => 
        item.productId && item.quantity && item.unitPrice
      );

      if (validItems.length === 0) {
        throw new Error("Please add at least one product");
      }

      const payload = {
        order: {
          ...data,
          stationId: user?.stationId,
          userId: user?.id,
          currencyCode: currencyConfig.code,
        },
        items: validItems
      };
      const response = await apiRequest("POST", "/api/purchase-orders", payload);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create purchase order");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Purchase order created",
        description: "Purchase order has been created successfully",
      });
      setOpen(false);
      form.reset();
      setOrderItems([{ productId: "", quantity: "", unitPrice: "" }]);
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.refetchQueries({ queryKey: ["/api/purchase-orders"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create purchase order",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: any) => {
    const orderNumber = `PO${Date.now().toString().slice(-8)}`;
    const orderData = {
      ...data,
      orderNumber,
      stationId: user?.stationId,
      userId: user?.id,
      status: "pending",
    };
    createPurchaseOrderMutation.mutate(orderData);
  };

  const addOrderItem = () => {
    setOrderItems([...orderItems, { productId: "", quantity: "", unitPrice: "" }]);
  };

  const removeOrderItem = (index: number) => {
    if (orderItems.length > 1) {
      setOrderItems(orderItems.filter((_, i) => i !== index));
    }
  };

  const updateOrderItem = (index: number, field: string, value: string) => {
    const updated = [...orderItems];
    updated[index] = { ...updated[index], [field]: value };
    setOrderItems(updated);
  };

  const calculateTotal = () => {
    return orderItems.reduce((sum, item) => {
      const qty = parseFloat(item.quantity || "0");
      const price = parseFloat(item.unitPrice || "0");
      return sum + (qty * price);
    }, 0);
  };

  const { data: purchaseOrders = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/purchase-orders", user?.stationId],
    queryFn: async () => {
      if (!user?.stationId) return [];
      const response = await apiRequest("GET", `/api/purchase-orders/${user.stationId}`);
      return response.json();
    },
    enabled: !!user?.stationId,
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const handleResetFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setFromDate("");
    setToDate("");
  };

  const handlePrintReport = () => {
    const reportData = filteredOrders.map((order: PurchaseOrder) => ({
      'Order ID': order.orderNumber || order.id,
      'Supplier': order.supplier?.name || 'N/A',
      'Order Date': order.orderDate ? format(new Date(order.orderDate), 'MMM dd, yyyy') : 'N/A',
      'Amount': formatCurrency(parseFloat(order.totalAmount || '0')),
      'Status': order.status
    }));

    printReport({
      title: 'Purchase Orders Report',
      subtitle: 'All Purchase Orders',
      data: reportData,
      summary: [
        { label: 'Total Orders', value: filteredOrders.length.toString() },
        { label: 'Total Value', value: formatCurrency(totalValue) }
      ]
    });
  };

  const filteredOrders = purchaseOrders.filter((order: PurchaseOrder) => {
    const matchesSearch = order.supplier?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         order.notes?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         order.orderNumber?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || order.status === statusFilter;

    let matchesDateRange = true;
    if (fromDate && toDate) {
      const orderDate = order.orderDate ? new Date(order.orderDate).toISOString().split('T')[0] : '';
      matchesDateRange = orderDate >= fromDate && orderDate <= toDate;
    } else if (fromDate) {
      const orderDate = order.orderDate ? new Date(order.orderDate).toISOString().split('T')[0] : '';
      matchesDateRange = orderDate >= fromDate;
    } else if (toDate) {
      const orderDate = order.orderDate ? new Date(order.orderDate).toISOString().split('T')[0] : '';
      matchesDateRange = orderDate <= toDate;
    }

    return matchesSearch && matchesStatus && matchesDateRange;
  });


  const handleViewOrder = (order: PurchaseOrder) => {
    navigate(`/purchase-invoice-view/${order.id}`);
  };

  const deletePurchaseOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const response = await apiRequest("DELETE", `/api/purchase-orders/${orderId}`);
      if (!response.ok) {
        throw new Error("Failed to delete purchase order");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Purchase order deleted",
        description: "Purchase order has been deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.refetchQueries({ queryKey: ["/api/purchase-orders"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete purchase order",
        variant: "destructive",
      });
    },
  });

  const handleDeletePurchaseOrder = (orderId: string) => {
    if (confirm('Are you sure you want to delete this purchase order? This action cannot be undone.')) {
      deletePurchaseOrderMutation.mutate(orderId);
    }
  };


  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-muted rounded w-1/2 mb-8"></div>
          <div className="h-96 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  const totalOrders = filteredOrders.length;
  const pendingOrders = filteredOrders.filter(order => order.status === 'pending').length;
  const totalValue = filteredOrders.reduce((sum, order) => sum + parseFloat(order.totalAmount || '0'), 0);

  const statusOptions = [
    { value: "all", label: "All Status" },
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "delivered", label: "Delivered" },
    { value: "cancelled", label: "Cancelled" }
  ];

  const handleNewPurchaseOrder = () => {
    setOpen(true);
    setOrderItems([{ productId: "", quantity: "", unitPrice: "" }]);
    form.reset({
      supplierId: "",
      orderDate: new Date().toISOString().split('T')[0],
      notes: "",
      status: "pending" as const,
    });
  };

  return (
    <div className="space-y-6 fade-in">
      <StandardPageHeader
        title="Purchase Orders"
        subtitle="Manage supplier orders and inventory procurement"
      >
        <Button onClick={handleNewPurchaseOrder} data-testid="button-create-purchase-order">
          <Plus className="w-4 h-4 mr-2" />
          New Purchase Order
        </Button>
      </StandardPageHeader>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-primary">{totalOrders}</div>
            <div className="text-sm text-muted-foreground">Total Orders</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-orange-600">{pendingOrders}</div>
            <div className="text-sm text-muted-foreground">Pending Orders</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-green-600">{formatCurrency(totalValue)}</div>
            <div className="text-sm text-muted-foreground">Total Value</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-blue-600">{suppliers.length}</div>
            <div className="text-sm text-muted-foreground">Active Suppliers</div>
          </CardContent>
        </Card>
      </div>

      <StandardFilterBar
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Search orders by ID, Supplier, or Notes..."
        showDateFilter={true}
        fromDate={fromDate}
        toDate={toDate}
        onFromDateChange={setFromDate}
        onToDateChange={setToDate}
        statusOptions={statusOptions}
        statusValue={statusFilter}
        onStatusChange={setStatusFilter}
        statusLabel="Status"
        onClearFilters={handleResetFilters}
        onPrintReport={handlePrintReport}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Purchase Order</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="supplierId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Supplier *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select supplier" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {suppliers.map((supplier) => (
                          <SelectItem key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="orderDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Order Date *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="delivered">Delivered</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <FormLabel>Products *</FormLabel>
                  <Button type="button" size="sm" onClick={addOrderItem}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add Product
                  </Button>
                </div>
                {orderItems.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-end border p-3 rounded">
                    <div className="col-span-5">
                      <label className="text-sm">Product</label>
                      <Select 
                        value={item.productId} 
                        onValueChange={(value) => updateOrderItem(index, 'productId', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select product" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((product) => (
                            <SelectItem key={product.id} value={product.id}>
                              {product.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3">
                      <label className="text-sm">Quantity</label>
                      <Input 
                        type="number" 
                        step="0.01"
                        value={item.quantity}
                        onChange={(e) => updateOrderItem(index, 'quantity', e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="text-sm">Unit Price</label>
                      <Input 
                        type="number" 
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => updateOrderItem(index, 'unitPrice', e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="col-span-1">
                      {orderItems.length > 1 && (
                        <Button 
                          type="button" 
                          size="sm" 
                          variant="destructive"
                          onClick={() => removeOrderItem(index)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="text-right font-semibold">
                  Total: {formatCurrency(calculateTotal())}
                </div>
              </div>
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Order notes and specifications" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end space-x-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createPurchaseOrderMutation.isPending}>
                  {createPurchaseOrderMutation.isPending ? "Creating..." : "Create Order"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Orders Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Purchase Orders</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3 font-medium">Order ID</th>
                  <th className="text-left p-3 font-medium">Supplier</th>
                  <th className="text-left p-3 font-medium">Order Date</th>
                  <th className="text-right p-3 font-medium">Amount</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-center p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length > 0 ? filteredOrders.map((order: PurchaseOrder) => (
                  <tr key={order.id} className="border-b border-border hover:bg-muted/50">
                    <td className="p-3 font-mono text-sm">{order.orderNumber || order.id}</td>
                    <td className="p-3">
                      <div className="font-medium">{order.supplier?.name || 'Unknown Supplier'}</div>
                      <div className="text-sm text-muted-foreground">{order.supplier?.contactPerson || ''}</div>
                    </td>
                    <td className="p-3">
                      {order.orderDate ? format(new Date(order.orderDate), 'MMM dd, yyyy') : 'N/A'}
                    </td>
                    <td className="p-3 text-right font-semibold">
                      {formatCurrency(parseFloat(order.totalAmount || '0'))}
                    </td>
                    <td className="p-3 text-center">
                      <Badge
                        variant={order.status === 'pending' ? 'secondary' :
                                order.status === 'approved' ? 'default' :
                                order.status === 'delivered' ? 'default' : 'destructive'}
                        className={
                          order.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          order.status === 'approved' ? 'bg-blue-100 text-blue-800' :
                          order.status === 'delivered' ? 'bg-green-100 text-green-800' :
                          'bg-red-100 text-red-800'
                        }
                      >
                        {order.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewOrder(order)}
                          className="p-2"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeletePurchaseOrder(order.id)}
                          className="p-2"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      No purchase orders found for the selected criteria
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* View Order Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Purchase Order Details</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Order ID</label>
                  <p className="text-sm text-muted-foreground font-mono">{selectedOrder.orderNumber || selectedOrder.id}</p>
                </div>
                <div>
                  <label className="text-sm font-medium">Supplier</label>
                  <p className="text-sm text-muted-foreground">{selectedOrder.supplier?.name || 'Unknown'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium">Order Date</label>
                  <p className="text-sm text-muted-foreground">
                    {selectedOrder.orderDate ? format(new Date(selectedOrder.orderDate), 'MMM dd, yyyy') : 'N/A'}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">Total Amount</label>
                  <p className="text-sm text-muted-foreground">{formatCurrency(parseFloat(selectedOrder.totalAmount || '0'))}</p>
                </div>
                <div>
                  <label className="text-sm font-medium">Status</label>
                  <Badge className="w-fit">{selectedOrder.status}</Badge>
                </div>
                <div>
                  <label className="text-sm font-medium">Expected Delivery</label>
                  <p className="text-sm text-muted-foreground">
                    {selectedOrder.expectedDeliveryDate ? format(new Date(selectedOrder.expectedDeliveryDate), 'MMM dd, yyyy') : 'Not specified'}
                  </p>
                </div>
              </div>
              {selectedOrder.notes && (
                <div>
                  <label className="text-sm font-medium">Notes</label>
                  <p className="text-sm text-muted-foreground">{selectedOrder.notes}</p>
                </div>
              )}
              {selectedOrder.items && selectedOrder.items.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Items</label>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted">
                        <th className="p-2 text-left">Product</th>
                        <th className="p-2 text-right">Quantity</th>
                        <th className="p-2 text-right">Unit Price</th>
                        <th className="p-2 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.items.map((item, index) => (
                        <tr key={index} className="border-b">
                          <td className="p-2">{item.product?.name || 'Unknown Product'}</td>
                          <td className="p-2 text-right">{item.quantity}</td>
                          <td className="p-2 text-right">{formatCurrency(parseFloat(item.unitPrice || '0'))}</td>
                          <td className="p-2 text-right font-semibold">{formatCurrency(parseFloat(item.quantity || '0') * parseFloat(item.unitPrice || '0'))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}